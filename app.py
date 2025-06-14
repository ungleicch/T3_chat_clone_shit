#!/usr/bin/env python3
# --- Local AI Chat Backend ---
# This Flask application provides the complete backend for a local AI chat interface,
# powered by Ollama. It includes folder-based chat history, file attachments
# (PDF, DOCX, text), vision model support, and a multi-step web search tool.
# It is designed to be robust, handling client-side interruptions gracefully
# by saving partial responses.

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
TITLE_GENERATION_MODEL = 'gemma3:1b'
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
def prepare_messages_for_llm(messages, include_images=False, chat_id=None):
    """
    Creates a deep copy of messages and prepares them for the Ollama API.
    - Merges extracted file text into the user prompt.
    - If vision is enabled, base64-encodes and attaches images.
    """
    prepared_messages = copy.deepcopy(messages)
    
    # Process text and attachments for the last user message
    if prepared_messages and prepared_messages[-1].get('role') == 'user':
        last_msg = prepared_messages[-1]
        
        # Merge extracted text content
        if 'extracted_content' in last_msg:
            full_prompt = f"{last_msg['content']}\n\n--- Start of attached document content ---\n{last_msg['extracted_content']}\n--- End of attached document content ---"
            last_msg['content'] = full_prompt
            del last_msg['extracted_content']

        # Handle images if requested
        if include_images and 'attachments' in last_msg and chat_id:
            images_b64 = []
            for att in last_msg.get('attachments', []):
                if att.get('type', '').startswith('image/'):
                    try:
                        filename = Path(att['url']).name
                        attachment_path = CHATS_DIR / chat_id / ATTACHMENTS_DIR_NAME / filename
                        with open(attachment_path, 'rb') as img_file:
                            images_b64.append(base64.b64encode(img_file.read()).decode('utf-8'))
                    except Exception as e:
                        print(f"Error reading image attachment {att['url']}: {e}")
            if images_b64:
                last_msg['images'] = images_b64
                
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

# --- Core Business Logic ---
def generate_chat_title(prompt_text):
    """
    Generates a short title for a chat based on the user's initial text prompt.
    This function explicitly IGNORES file content for concise and relevant titles.
    """
    if not prompt_text: return "New Chat"
    if len(prompt_text) < 40: return prompt_text.strip()
    try:
        system_prompt = "Summarize the following user's query into a short, 3-to-5-word title for a chat history list. Do not use quotation marks. Be concise."
        response = ollama.chat(
            model=TITLE_GENERATION_MODEL,
            messages=[{'role': 'system', 'content': system_prompt}, {'role': 'user', 'content': prompt_text}],
            options={"num_predict": 20}
        )
        title = response['message']['content'].strip()
        # Clean up potential quotes around the title
        return re.sub(r'^["\']|["\']$', '', title) if title else "Untitled Chat"
    except Exception as e:
        print(f"Warning: Could not generate title with LLM ({e}). Using prompt as fallback.")
        return prompt_text[:50].strip() + "..."

def process_and_save_files(chat_id, files):
    """Processes uploaded files, extracts text content, and saves them."""
    attachments_data = []
    extracted_text = ""
    if not files: return attachments_data, extracted_text

    chat_attachments_dir = CHATS_DIR / chat_id / ATTACHMENTS_DIR_NAME
    chat_attachments_dir.mkdir(parents=True, exist_ok=True)

    for file in files:
        original_filename = file.filename
        unique_filename = f"{uuid.uuid4()}{Path(original_filename).suffix}"
        save_path = chat_attachments_dir / unique_filename
        
        file_content = file.read() # Read once
        file.seek(0) # Rewind for any other potential reads
        
        with open(save_path, 'wb') as f:
            f.write(file_content)

        attachment_info = {
            "original_filename": original_filename,
            "url": f"/attachments/{chat_id}/{unique_filename}",
            "type": file.content_type
        }
        attachments_data.append(attachment_info)
        
        # Extract text from supported document types
        try:
            if original_filename.lower().endswith('.pdf'):
                with fitz.open(stream=file_content, filetype="pdf") as doc:
                    text = "".join(page.get_text() for page in doc)
                    extracted_text += f"\n\n--- Content from PDF: {original_filename} ---\n{text}\n"
            elif original_filename.lower().endswith('.docx'):
                document = docx.Document(BytesIO(file_content))
                text = "\n".join([para.text for para in document.paragraphs])
                extracted_text += f"\n\n--- Content from DOCX: {original_filename} ---\n{text}\n"
            elif file.content_type.startswith('text/'):
                text = file_content.decode('utf-8', errors='replace')
                extracted_text += f"\n\n--- Content from Text File: {original_filename} ---\n{text}\n"
        except Exception as e:
            print(f"Error processing text from {original_filename}: {e}")
            extracted_text += f"\n\n--- Could not extract text from {original_filename} ---\n"

    return attachments_data, extracted_text.strip()


def _stream_response_generator(chat_id, chat_data, model):
    """
    Core generator for handling chat responses. It supports multi-step tool use (web search)
    and ensures that even interrupted responses are saved correctly.
    """
    full_response_content = ""
    final_model = model
    sources_used = []
    
    try:
        messages_to_process = list(chat_data['messages'])[-CONTEXT_WINDOW_MESSAGES:]
        
        # Determine if any images are in the last user message
        has_images = any(
            att.get('type', '').startswith('image/') 
            for att in messages_to_process[-1].get('attachments', [])
        )
        if has_images:
            final_model = FIXED_VISION_MODEL
            print(f"Image detected. Switching to vision model: {final_model}")

        # Check for web search activation
        is_web_search_turn = messages_to_process[-1].get('content', '').startswith('[Web Search Activated]')
        if is_web_search_turn:
            # Temporarily modify the message list for this turn to include the system prompt
            search_messages = copy.deepcopy(messages_to_process)
            search_messages[-1]['content'] = search_messages[-1]['content'].replace('[Web Search Activated]', '').strip()
            search_messages.insert(0, {'role': 'system', 'content': WEB_SEARCH_SYSTEM_PROMPT})
            messages_for_api = prepare_messages_for_llm(search_messages)
        else:
            messages_for_api = prepare_messages_for_llm(messages_to_process, include_images=has_images, chat_id=chat_id)

        # Main loop for tool use (e.g., search -> answer)
        for _ in range(3): # Max 3 tool uses to prevent infinite loops
            response = ollama.chat(model=final_model, messages=messages_for_api)
            assistant_message = response['message']
            search_match = re.search(r'<search>(.*?)</search>', assistant_message['content'], re.DOTALL)

            if not search_match: # No tool use, this is the final answer
                stream = ollama.chat(model=final_model, messages=messages_for_api, stream=True)
                for chunk in stream:
                    if 'content' in chunk['message']:
                        content_piece = chunk['message']['content']
                        full_response_content += content_piece
                        yield content_piece
                
                if sources_used:
                    sources_markdown = "\n\n---\n**Sources:**\n"
                    for i, source in enumerate(sources_used):
                        sources_markdown += f"{i+1}. [{source['title']}]({source['url']}) - *Query: {source['query']}*\n"
                    full_response_content += sources_markdown
                    yield sources_markdown
                return # End the generator successfully

            # Tool use detected (Web Search)
            try:
                search_json_str = search_match.group(1).strip()
                search_data = json.loads(search_json_str)
                search_query = search_data['query']
                print(f"Model requested search for: '{search_query}'")
                search_status_msg = f"Searching the web for: `{search_query}`\n\n"
                full_response_content += search_status_msg
                yield search_status_msg

                with DDGS() as ddgs: search_results = list(ddgs.text(search_query, max_results=5))

                results_text = f"Search results for '{search_query}':\n\n"
                for i, result in enumerate(search_results):
                    results_text += f"Result {i+1}:\nTitle: {result['title']}\nURL: {result['href']}\nSnippet: {result['body']}\n\n"
                    sources_used.append({"title": result['title'], "url": result['href'], "query": search_query})
                
                messages_for_api.append(assistant_message)
                messages_for_api.append({'role': 'user', 'content': results_text})
            except Exception as e:
                print(f"Error during search tool use: {e}")
                error_msg = f"An error occurred while trying to perform a web search: {e}"
                full_response_content += error_msg
                yield error_msg
                return

    except GeneratorExit:
        print(f"Stream for chat {chat_id} was aborted by the client.")
    except Exception as e:
        print(f"An unexpected error occurred in the generator for chat {chat_id}: {e}")
        traceback.print_exc()
        yield f"An unexpected error occurred: {str(e)}"
    finally:
        # This block executes on successful completion OR when the client disconnects (GeneratorExit).
        # This is the CRITICAL part that ensures interrupted responses are saved.
        if full_response_content:
            print(f"Saving final/partial response for chat {chat_id}. Length: {len(full_response_content)}")
            final_ai_message = {'role': 'assistant', 'content': full_response_content, 'model': final_model}
            current_chat_data = load_chat_history(chat_id)
            if current_chat_data:
                # Append the new message, ensuring it's not a duplicate from a previous failed save
                if not current_chat_data['messages'] or current_chat_data['messages'][-1] != final_ai_message:
                    current_chat_data['messages'].append(final_ai_message)
                    save_chat_history(chat_id, current_chat_data)


# --- API Endpoints ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/attachments/<chat_id>/<filename>')
def get_attachment(chat_id, filename):
    if not re.match(r'^[a-zA-Z0-9-]+$', chat_id) or '..' in filename: abort(400)
    directory = CHATS_DIR / chat_id / ATTACHMENTS_DIR_NAME
    if not directory.is_dir(): abort(404)
    return send_from_directory(directory, filename)

@app.route('/api/models', methods=['GET'])
def get_models():
    try:
        response = ollama.list()
        all_model_objects = response.get('models', [])
        text_models_as_dicts = []
        for model_obj in all_model_objects:
            model_name = model_obj.get('name') or model_obj.get('model')
            if model_name:
                is_vision = 'llava' in model_name.lower() or 'vision' in model_name.lower()
                is_embed = 'embed' in model_name.lower()
                if not is_vision and not is_embed:
                    text_models_as_dicts.append({ 'name': model_name })
        return jsonify(text_models_as_dicts)
    except Exception as e:
        print(f"CRITICAL: Error fetching models from Ollama: {e}")
        return jsonify({"error": f"Could not connect to Ollama. Details: {str(e)}"}), 500

@app.route('/api/chats', methods=['GET'])
def get_all_chats():
    return jsonify(get_all_chats_from_disk())

@app.route('/api/chat/<chat_id>', methods=['GET'])
def get_chat_history_route(chat_id):
    chat_data = load_chat_history(chat_id)
    if chat_data is None: abort(404, "Chat not found")
    return jsonify(chat_data)

@app.route('/api/chat/stream', defaults={'chat_id': None}, methods=['POST'])
@app.route('/api/chat/<chat_id>/stream', methods=['POST'])
def stream_message(chat_id):
    model = request.form.get('model')
    prompt = request.form.get('prompt', '')
    files = request.files.getlist('files')

    if not model: return Response("Model not provided", status=400)
    if not prompt and not files: return Response("Cannot start a chat with an empty message.", status=400)

    is_new_chat = not chat_id
    if is_new_chat:
        chat_id = str(uuid.uuid4())
        chat_data = {"title": "New Chat", "messages": []}
    else:
        chat_data = load_chat_history(chat_id)
        if not chat_data: return Response("Chat not found.", status=404)

    attachments_data, extracted_text = process_and_save_files(chat_id, files)
    
    user_message = {"role": "user", "content": prompt}
    if attachments_data: user_message["attachments"] = attachments_data
    if extracted_text: user_message["extracted_content"] = extracted_text
    
    chat_data['messages'].append(user_message)
    save_chat_history(chat_id, chat_data)

    def full_stream():
        # Part 1: Yield initial metadata for the frontend to render the user message instantly
        initial_data = {"chatId": chat_id, "user_message": user_message}
        yield json.dumps(initial_data) + '\n---\n'
        
        # Part 2: Yield the AI's response stream
        for chunk in _stream_response_generator(chat_id, chat_data, model):
            yield chunk

    return Response(full_stream(), mimetype='text/plain')

@app.route('/api/chat/<chat_id>/generate_title', methods=['POST'])
def generate_title_for_chat_route(chat_id):
    chat_data = load_chat_history(chat_id)
    if not chat_data or not chat_data.get('messages'): return jsonify({"error": "Chat not found or is empty."}), 404
    
    first_user_prompt = ""
    for message in chat_data['messages']:
        if message['role'] == 'user':
            # THE FIX: Only use the user's text content for title generation.
            # Do NOT include extracted PDF/DOCX content.
            user_text = message['content'].replace('[Web Search Activated]', '').strip()
            first_user_prompt = user_text
            break
            
    if not first_user_prompt: return jsonify({"title": "Untitled Chat"})

    new_title = generate_chat_title(first_user_prompt)
    chat_data['title'] = new_title
    save_chat_history(chat_id, chat_data)
    return jsonify({"chatId": chat_id, "newTitle": new_title})
        
@app.route('/api/chat/<chat_id>/message/<int:msg_index>', methods=['DELETE'])
def delete_message(chat_id, msg_index):
    chat_data = load_chat_history(chat_id)
    if not chat_data: return jsonify({"error": "Chat not found."}), 404
    if not 0 <= msg_index < len(chat_data['messages']): return jsonify({"error": "Invalid message index."}), 400
    
    message_to_delete = chat_data['messages'][msg_index]
    if message_to_delete['role'] == 'user' and msg_index + 1 < len(chat_data['messages']) and chat_data['messages'][msg_index + 1]['role'] == 'assistant':
        chat_data['messages'].pop(msg_index + 1) # Delete assistant's reply
    
    chat_data['messages'].pop(msg_index) # Delete the target message
            
    save_chat_history(chat_id, chat_data)
    return jsonify({"success": True, "remaining_messages": chat_data['messages']})

@app.route('/api/chat/<chat_id>/regenerate', methods=['POST'])
def regenerate_response(chat_id):
    data = request.json
    model = data.get('model')
    msg_index = data.get('msg_index')

    if not model or msg_index is None: return Response("Model and message index not provided.", status=400)
    chat_data = load_chat_history(chat_id)
    if not chat_data: return Response("Chat not found", status=404)
    if not (0 <= msg_index < len(chat_data['messages']) and chat_data['messages'][msg_index]['role'] == 'assistant'):
        return Response("Invalid index for regeneration.", status=400)
    
    # Prune the conversation to the point *before* the message to be regenerated
    chat_data['messages'] = chat_data['messages'][:msg_index]
    save_chat_history(chat_id, chat_data)
    
    # The response stream will automatically save the new message upon completion/interruption
    return Response(_stream_response_generator(chat_id, chat_data, model), mimetype='text/plain')

@app.route('/api/chat/<chat_id>/edit_and_regenerate', methods=['POST'])
def edit_and_regenerate(chat_id):
    data = request.json
    model, msg_index, new_prompt = data.get('model'), data.get('msg_index'), data.get('new_prompt')

    if not all([model, isinstance(msg_index, int), new_prompt is not None]): return jsonify({"error": "Missing required data."}), 400
    
    chat_data = load_chat_history(chat_id)
    if not chat_data: return jsonify({"error": "Chat not found"}), 404
    if not (0 <= msg_index < len(chat_data['messages']) and chat_data['messages'][msg_index]['role'] == 'user'):
        return jsonify({"error": "Invalid index for edit."}), 400

    # Update the user message and prune the history to that point
    chat_data['messages'][msg_index]['content'] = new_prompt
    chat_data['messages'] = chat_data['messages'][:msg_index + 1]
    save_chat_history(chat_id, chat_data)
    
    # Call the main streamer to get a new response
    # This automatically supports web search and interruptions for the edited prompt
    return Response(_stream_response_generator(chat_id, chat_data, model), mimetype='text/plain')

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