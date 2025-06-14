import os
import json
import uuid
import base64
import shutil
from io import BytesIO
from pathlib import Path
import traceback
import re
import copy

from flask import Flask, request, jsonify, render_template, abort, send_from_directory, Response
import ollama
from PIL import Image
import fitz  # PyMuPDF
import pillow_heif
import docx
from duckduckgo_search import DDGS

# Register the HEIC/HEIF file format opener with Pillow.
pillow_heif.register_heif_opener()

# --- Configuration ---
FIXED_VISION_MODEL = 'llava:latest'
CHATS_DIR = Path('chats')
ATTACHMENTS_DIR_NAME = 'attachments'
CHATS_DIR.mkdir(exist_ok=True)
TITLE_GENERATION_MODEL = 'mistral:latest'
CONTEXT_WINDOW_MESSAGES = 20

# System prompt to instruct the AI on how to use the web search tool.
WEB_SEARCH_SYSTEM_PROMPT = """You are a large language model with access to a real-time web search tool.
When the user asks a question that requires up-to-date information, financial data, or specific facts you might not know, you MUST use the search tool.

To use the search tool, you must respond with a special search command in the following JSON format, and nothing else:
<search>
{"query": "your concise search query here"}
</search>

You will receive the search results back. After you receive the results, you MUST answer the user's original question based on the information from the search results. Do not make up information.
"""

app = Flask(__name__)

# --- Helper Function to Prepare Messages for Ollama ---
def prepare_messages_for_llm(messages):
    """
    Creates a deep copy of messages and combines user content with
    extracted file content for the LLM. This prevents modifying the
    original chat history data.
    """
    prepared_messages = copy.deepcopy(messages)
    for msg in prepared_messages:
        if msg.get('role') == 'user' and 'extracted_content' in msg:
            full_prompt = f"{msg['content']}\n\n--- Start of attached document content ---\n{msg['extracted_content']}\n--- End of attached document content ---"
            msg['content'] = full_prompt
            del msg['extracted_content']
    return prepared_messages

# --- Chat History Management (Folder-based) ---
def get_all_chats_from_disk():
    chat_list = []
    for chat_folder in CHATS_DIR.iterdir():
        if chat_folder.is_dir():
            history_file = chat_folder / 'history.json'
            if history_file.exists():
                try:
                    with open(history_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    mtime = history_file.stat().st_mtime
                    chat_list.append({
                        "id": chat_folder.name,
                        "title": data.get("title", "Untitled Chat"),
                        "mtime": mtime
                    })
                except (json.JSONDecodeError, IOError) as e:
                    print(f"Warning: Could not read or parse {history_file}: {e}")
    return sorted(chat_list, key=lambda x: x['mtime'], reverse=True)

def load_chat_history(chat_id):
    history_file = CHATS_DIR / chat_id / 'history.json'
    if not history_file.exists(): return None
    try:
        with open(history_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None

def save_chat_history(chat_id, chat_data):
    chat_folder = CHATS_DIR / chat_id
    chat_folder.mkdir(exist_ok=True)
    history_file = chat_folder / 'history.json'
    with open(history_file, 'w', encoding='utf-8') as f:
        json.dump(chat_data, f, indent=4)

def generate_chat_title(prompt_text):
    if not prompt_text: return "New Chat"
    if len(prompt_text) < 40: return prompt_text
    try:
        system_prompt = "Summarize the following user's query into a short, 3-to-5-word title for a chat history list. Do not use quotation marks. Be concise."
        response = ollama.chat(
            model=TITLE_GENERATION_MODEL,
            messages=[{'role': 'system', 'content': system_prompt}, {'role': 'user', 'content': prompt_text}],
            options={"num_predict": 20}
        )
        title = response['message']['content'].strip()
        return re.sub(r'^["\']|["\']$', '', title) if title else "Untitled Chat"
    except Exception as e:
        print(f"Warning: Could not generate title with LLM ({e}). Using prompt as fallback.")
        return prompt_text[:50].strip()

def process_and_save_files(chat_id, files):
    attachments_data = []
    extracted_text = ""
    if not files:
        return attachments_data, extracted_text

    chat_attachments_dir = CHATS_DIR / chat_id / ATTACHMENTS_DIR_NAME
    chat_attachments_dir.mkdir(parents=True, exist_ok=True)

    for file in files:
        original_filename = file.filename
        unique_filename = f"{uuid.uuid4()}{Path(original_filename).suffix}"
        save_path = chat_attachments_dir / unique_filename

        file_stream = file.stream
        file_stream.seek(0)
        file_content = file_stream.read()

        with open(save_path, 'wb') as f:
            f.write(file_content)

        attachments_data.append({
            "original_filename": original_filename,
            "url": f"/attachments/{chat_id}/{unique_filename}",
            "type": file.content_type
        })

        file_stream.seek(0)
        if original_filename.lower().endswith('.pdf'):
            try:
                with fitz.open(stream=file_content, filetype="pdf") as doc:
                    text = "".join(page.get_text() for page in doc)
                    extracted_text += f"\n\n--- Content from PDF: {original_filename} ---\n{text}\n--- End of {original_filename} ---\n"
            except Exception as e:
                print(f"Error processing PDF {original_filename}: {e}")
        elif original_filename.lower().endswith('.docx'):
            try:
                document = docx.Document(BytesIO(file_content))
                text = "\n".join([para.text for para in document.paragraphs])
                extracted_text += f"\n\n--- Content from DOCX: {original_filename} ---\n{text}\n--- End of {original_filename} ---\n"
            except Exception as e:
                print(f"Error processing DOCX {original_filename}: {e}")
        elif file.content_type.startswith('text/'):
            try:
                text = file_content.decode('utf-8')
                extracted_text += f"\n\n--- Content from Text File: {original_filename} ---\n{text}\n--- End of {original_filename} ---\n"
            except Exception as e:
                print(f"Error processing text file {original_filename}: {e}")

    return attachments_data, extracted_text.strip()


def _stream_response_generator(chat_id, chat_data, model):
    """
    Generator that handles the entire chat response process, including
    potential web searches (tool use).
    """
    messages_to_process = list(chat_data['messages'])[-CONTEXT_WINDOW_MESSAGES:]
    
    is_web_search_turn = messages_to_process[-1]['content'].startswith('[Web Search Activated]')
    if is_web_search_turn:
        messages_to_process[-1]['content'] = messages_to_process[-1]['content'].replace('[Web Search Activated]', '').strip()
        messages_to_process.insert(0, {'role': 'system', 'content': WEB_SEARCH_SYSTEM_PROMPT})
    
    messages_for_api = prepare_messages_for_llm(messages_to_process)
    
    final_model = model
    sources_used = []

    for _ in range(3): # Allow up to 3 search attempts to prevent infinite loops
        response = ollama.chat(model=final_model, messages=messages_for_api)
        assistant_message = response['message']
        
        search_match = re.search(r'<search>(.*?)</search>', assistant_message['content'], re.DOTALL)
        
        if not search_match:
            # No search tool used, this is the final answer.
            stream = ollama.chat(model=final_model, messages=messages_for_api, stream=True)
            full_response_content = ""
            for chunk in stream:
                if 'content' in chunk['message']:
                    content_piece = chunk['message']['content']
                    full_response_content += content_piece
                    yield content_piece
            
            if sources_used:
                sources_markdown = "\n\n---\n**Sources:**\n"
                for i, source in enumerate(sources_used):
                    sources_markdown += f"{i+1}. [{source['title']}]({source['url']}) - *Query: {source['query']}*\n"
                yield sources_markdown
                full_response_content += sources_markdown

            final_ai_message = {'role': 'assistant', 'content': full_response_content, 'model': final_model}
            current_chat_data = load_chat_history(chat_id)
            if current_chat_data:
                current_chat_data['messages'].append(final_ai_message)
                save_chat_history(chat_id, current_chat_data)
            return

        try:
            search_json_str = search_match.group(1).strip()
            search_data = json.loads(search_json_str)
            search_query = search_data['query']
            print(f"Model requested search for: '{search_query}'")

            with DDGS() as ddgs:
                search_results = list(ddgs.text(search_query, max_results=5))

            results_text = f"Search results for '{search_query}':\n\n"
            for i, result in enumerate(search_results):
                results_text += f"Result {i+1}:\nTitle: {result['title']}\nURL: {result['href']}\nSnippet: {result['body']}\n\n"
                sources_used.append({"title": result['title'], "url": result['href'], "query": search_query})

            messages_for_api.append(assistant_message)
            messages_for_api.append({'role': 'user', 'content': results_text})
        except Exception as e:
            print(f"Error during search tool use: {e}")
            yield f"An error occurred while trying to perform a web search: {e}"
            return

# --- API Endpoints ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/attachments/<chat_id>/<filename>')
def get_attachment(chat_id, filename):
    if not re.match(r'^[a-zA-Z0-9-]+$', chat_id) or '..' in filename:
        abort(400)
    directory = CHATS_DIR / chat_id / ATTACHMENTS_DIR_NAME
    if not directory.is_dir():
        abort(404)
    return send_from_directory(directory, filename)

@app.route('/api/models', methods=['GET'])
def get_models():
    try:
        response = ollama.list()
        text_models_as_dicts = []
        for model_obj in response.get('models', []):
            model_name = model_obj.get('name') or model_obj.get('model')
            if model_name:
                is_vision = 'llava' in model_name.lower() or 'vision' in model_name.lower()
                is_embed = 'embed' in model_name.lower()
                if not is_vision and not is_embed:
                    text_models_as_dicts.append({
                        'name': model_name,
                        'modified_at': model_obj.get('modified_at'),
                        'size': model_obj.get('size')
                    })
        return jsonify(text_models_as_dicts)
    except Exception as e:
        print(f"CRITICAL: Error fetching models from Ollama: {e}")
        traceback.print_exc()
        return jsonify({"error": f"Could not connect to Ollama. Details: {str(e)}"}), 500

@app.route('/api/chats', methods=['GET'])
def get_all_chats():
    return jsonify(get_all_chats_from_disk())

@app.route('/api/chat/<chat_id>', methods=['GET'])
def get_chat_history_route(chat_id):
    chat_data = load_chat_history(chat_id)
    if chat_data is None:
        abort(404, "Chat not found")
    return jsonify(chat_data)

@app.route('/api/chat/stream', defaults={'chat_id': None}, methods=['POST'])
@app.route('/api/chat/<chat_id>/stream', methods=['POST'])
def stream_message(chat_id):
    model = request.form.get('model')
    prompt = request.form.get('prompt', '')
    files = request.files.getlist('files')

    if not model:
        return Response("Model not provided", status=400)
    if not prompt and not files:
        return Response("Cannot start a chat with an empty message.", status=400)

    is_new_chat = not chat_id
    if is_new_chat:
        chat_id = str(uuid.uuid4())
        chat_data = {"title": "New Chat", "messages": []}
    else:
        chat_data = load_chat_history(chat_id)
        if not chat_data:
            return Response("Chat not found.", status=404)

    attachments_data, extracted_text = process_and_save_files(chat_id, files)
    
    user_message = {"role": "user", "content": prompt}
    if attachments_data:
        user_message["attachments"] = attachments_data
    if extracted_text:
        user_message["extracted_content"] = extracted_text
    
    chat_data['messages'].append(user_message)
    save_chat_history(chat_id, chat_data)

    def full_stream():
        initial_data = {"chatId": chat_id, "user_message": user_message}
        yield json.dumps(initial_data) + '\n---\n'
        for chunk in _stream_response_generator(chat_id, chat_data, model):
            yield chunk

    return Response(full_stream(), mimetype='text/plain')

@app.route('/api/chat/<chat_id>/generate_title', methods=['POST'])
def generate_title_for_chat(chat_id):
    chat_data = load_chat_history(chat_id)
    if not chat_data or not chat_data.get('messages'):
        return jsonify({"error": "Chat not found or is empty."}), 404
        
    first_user_prompt = ""
    for message in chat_data['messages']:
        if message['role'] == 'user':
            user_content = message['content'].replace('[Web Search Activated]', '').strip()
            extracted_content = message.get('extracted_content', '')
            full_prompt = f"{user_content}\n\n{extracted_content}".strip()
            first_user_prompt = full_prompt
            break
            
    if not first_user_prompt:
        return jsonify({"title": "Untitled Chat"})

    new_title = generate_chat_title(first_user_prompt)
    chat_data['title'] = new_title
    save_chat_history(chat_id, chat_data)
    
    return jsonify({"chatId": chat_id, "newTitle": new_title})
        
@app.route('/api/chat/<chat_id>/message/<int:msg_index>', methods=['DELETE'])
def delete_message(chat_id, msg_index):
    chat_data = load_chat_history(chat_id)
    if not chat_data:
        return jsonify({"error": "Chat not found."}), 404
    if not 0 <= msg_index < len(chat_data['messages']):
        return jsonify({"error": "Invalid message index."}), 400
    
    message_to_delete = chat_data['messages'][msg_index]
    
    if message_to_delete['role'] == 'user':
        if msg_index + 1 < len(chat_data['messages']) and chat_data['messages'][msg_index + 1]['role'] == 'assistant':
            chat_data['messages'].pop(msg_index + 1)
        chat_data['messages'].pop(msg_index)
    elif message_to_delete['role'] == 'assistant':
        chat_data['messages'].pop(msg_index)
            
    save_chat_history(chat_id, chat_data)
    return jsonify({"success": True})

@app.route('/api/chat/<chat_id>/regenerate', methods=['POST'])
def regenerate_response(chat_id):
    data = request.json
    model = data.get('model')
    msg_index = data.get('msg_index')

    if not model or msg_index is None:
        return Response("Model and message index not provided.", status=400)
        
    chat_data = load_chat_history(chat_id)
    if not chat_data:
        return Response("Chat not found", status=404)

    if not (0 <= msg_index < len(chat_data['messages']) and chat_data['messages'][msg_index]['role'] == 'assistant'):
        return Response("Invalid index for regeneration.", status=400)
    
    chat_data['messages'] = chat_data['messages'][:msg_index]
    save_chat_history(chat_id, chat_data)
    
    return Response(_stream_response_generator(chat_id, chat_data, model), mimetype='text/plain')

@app.route('/api/chat/<chat_id>/edit_and_regenerate', methods=['POST'])
def edit_and_regenerate(chat_id):
    data = request.json
    model = data.get('model')
    msg_index = data.get('msg_index')
    new_prompt = data.get('new_prompt')

    if not all([model, isinstance(msg_index, int), new_prompt is not None]):
        return jsonify({"error": "Missing required data."}), 400
    
    chat_data = load_chat_history(chat_id)
    if not chat_data:
        return jsonify({"error": "Chat not found"}), 404
    if not (0 <= msg_index < len(chat_data['messages']) and chat_data['messages'][msg_index]['role'] == 'user'):
        return jsonify({"error": "Invalid index for edit."}), 400

    chat_data['messages'][msg_index]['content'] = new_prompt
    chat_data['messages'] = chat_data['messages'][:msg_index + 1]
    save_chat_history(chat_id, chat_data)
        
    messages_for_api = prepare_messages_for_llm(chat_data['messages'])
    
    try:
        response = ollama.chat(model=model, messages=messages_for_api)
        ai_message_dict = response['message']
        ai_message_dict['model'] = model
        
        current_chat_data = load_chat_history(chat_id)
        current_chat_data['messages'].append(ai_message_dict)
        save_chat_history(chat_id, current_chat_data)
        
        return jsonify({"response": ai_message_dict})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Error during edit and regeneration: {str(e)}"}), 500

@app.route('/api/chat/<chat_id>', methods=['DELETE'])
def delete_chat(chat_id):
    chat_folder = CHATS_DIR / chat_id
    if chat_folder.is_dir():
        try:
            shutil.rmtree(chat_folder)
            return jsonify({"success": True})
        except OSError as e:
            return jsonify({"error": f"Error deleting chat folder: {e}"}), 500
    return jsonify({"error": "Chat not found"}), 404

if __name__ == '__main__':
    app.run(debug=True, port=5005, host='0.0.0.0')