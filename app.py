import os
import json
import uuid
import base64
import shutil
from io import BytesIO
from pathlib import Path
import traceback
import re

from flask import Flask, request, jsonify, render_template, abort, send_from_directory, Response
import ollama
from PIL import Image
import fitz  # PyMuPDF
import pillow_heif
import docx

# Register the HEIC/HEIF file format opener with Pillow.
pillow_heif.register_heif_opener()

# --- Configuration ---
FIXED_VISION_MODEL = 'llava:latest'
CHATS_DIR = Path('chats')
ATTACHMENTS_DIR_NAME = 'attachments'
CHATS_DIR.mkdir(exist_ok=True)
TITLE_GENERATION_MODEL = 'mistral:latest' 
CONTEXT_WINDOW_MESSAGES = 20

app = Flask(__name__)

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
        all_model_objects = response.get('models', [])
        text_models_as_dicts = []
        for model_obj in all_model_objects:
            model_name = model_obj.get('name') or model_obj.get('model')
            if model_name:
                is_vision = 'llava' in model_name.lower() or 'vision' in model_name.lower()
                is_embed = 'embed' in model_name.lower()
                is_title_model = model_name == TITLE_GENERATION_MODEL
                if not is_vision and not is_embed and not is_title_model:
                    text_models_as_dicts.append({
                        'name': model_name,
                        'modified_at': model_obj.get('modified_at'),
                        'size': model_obj.get('size'),
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

@app.route('/api/chat/<chat_id>/generate_title', methods=['POST'])
def generate_title_for_chat(chat_id):
    chat_data = load_chat_history(chat_id)
    if not chat_data or not chat_data.get('messages'):
        return jsonify({"error": "Chat not found or is empty."}), 404
        
    # Find the first user message to generate the title from.
    first_user_prompt = ""
    for message in chat_data['messages']:
        if message['role'] == 'user':
            first_user_prompt = message['content']
            break
            
    if not first_user_prompt:
        return jsonify({"title": "Untitled Chat"}) # Nothing to generate from

    # Generate the real title.
    new_title = generate_chat_title(first_user_prompt)
    
    # Save the new title to the chat history file.
    chat_data['title'] = new_title
    save_chat_history(chat_id, chat_data)
    
    return jsonify({"chatId": chat_id, "newTitle": new_title})

@app.route('/api/chat/initiate', methods=['POST'])
def initiate_chat():
    data = request.form
    files = request.files.getlist('files')
    prompt = data.get('prompt', '')

    if not prompt and not files:
        return jsonify({"error": "Cannot start a chat with an empty message."}), 400

    chat_id = str(uuid.uuid4())
    
    # THE FIX: Use a temporary title immediately.
    title = "New Chat" 
    
    attachments_data, extracted_text = process_and_save_files(chat_id, files)
    full_prompt = f"{prompt}\n\n{extracted_text}".strip()

    user_message = {"role": "user", "content": full_prompt}
    if attachments_data:
        user_message["attachments"] = attachments_data

    # Save with the temporary title first.
    chat_data = {"title": title, "messages": [user_message]}
    save_chat_history(chat_id, chat_data)

    return jsonify({
        "chatId": chat_id,
        "title": title, # Return the temporary title
        "user_message": user_message
    })

@app.route('/api/chat/<chat_id>/add_message', methods=['POST'])
def add_message_to_chat(chat_id):
    chat_data = load_chat_history(chat_id)
    if not chat_data:
        return jsonify({"error": "Chat not found."}), 404

    data = request.form
    files = request.files.getlist('files')
    prompt = data.get('prompt', '')

    if not prompt and not files:
        return jsonify({"error": "Cannot add an empty message."}), 400

    attachments_data, extracted_text = process_and_save_files(chat_id, files)
    full_prompt = f"{prompt}\n\n{extracted_text}".strip()

    user_message = {"role": "user", "content": full_prompt}
    if attachments_data:
        user_message["attachments"] = attachments_data
    
    chat_data['messages'].append(user_message)
    save_chat_history(chat_id, chat_data)

    return jsonify({"user_message": user_message})

@app.route('/api/chat/<chat_id>/respond', methods=['POST'])
def get_chat_response(chat_id):
    model = request.json.get('model')
    if not model:
        return Response("Model not provided", status=400)
    
    chat_data = load_chat_history(chat_id)
    if not chat_data:
        return Response("Chat not found", status=404)

    messages_for_api = list(chat_data['messages'])[-CONTEXT_WINDOW_MESSAGES:]
    last_user_msg = messages_for_api[-1]
    final_model = model

    if 'attachments' in last_user_msg:
        api_user_message = last_user_msg.copy()
        images_b64 = []
        for att in api_user_message.get('attachments', []):
            if att.get('type', '').startswith('image/'):
                final_model = FIXED_VISION_MODEL
                try:
                    filename = Path(att['url']).name
                    attachment_path = CHATS_DIR / chat_id / ATTACHMENTS_DIR_NAME / filename
                    with open(attachment_path, 'rb') as img_file:
                        images_b64.append(base64.b64encode(img_file.read()).decode('utf-8'))
                except Exception as e:
                    print(f"Error reading attachment {att['url']}: {e}")
        if images_b64:
            api_user_message['images'] = images_b64
            messages_for_api[-1] = api_user_message

    try:
        stream = ollama.chat(model=final_model, messages=messages_for_api, stream=True)
        def generate():
            full_response_content = ""
            try:
                for chunk in stream:
                    if 'content' in chunk['message']:
                        content_piece = chunk['message']['content']
                        full_response_content += content_piece
                        yield content_piece
                
                ai_message_dict = {'role': 'assistant', 'content': full_response_content, 'model': final_model}
                current_chat_data = load_chat_history(chat_id)
                current_chat_data['messages'].append(ai_message_dict)
                save_chat_history(chat_id, current_chat_data)
            except Exception as e:
                print(f"Error during response generation stream for chat {chat_id}: {e}")

        return Response(generate(), mimetype='text/plain')
    except Exception as e:
        traceback.print_exc()
        error_message = f"Ollama API Error: {str(e)}"
        return Response(error_message, status=500)
        
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

# in app.py

@app.route('/api/chat/<chat_id>/regenerate', methods=['POST'])
def regenerate_response(chat_id):
    data = request.json
    model = data.get('model')
    msg_index = data.get('msg_index')

    if not model:
        return jsonify({"error": "Model not provided."}), 400
    chat_data = load_chat_history(chat_id)
    if not chat_data:
        return jsonify({"error": "Chat not found"}), 404
    if not (0 < msg_index < len(chat_data['messages']) and chat_data['messages'][msg_index]['role'] == 'assistant'):
        return jsonify({"error": "Invalid index for regeneration."}), 400
    
    # THE FIX: Context is all messages *before* the one being regenerated
    messages_for_api = chat_data['messages'][:msg_index]
    
    last_user_msg = messages_for_api[-1]
    final_model = model

    if 'attachments' in last_user_msg:
        api_user_message = last_user_msg.copy()
        images_b64 = []
        for att in api_user_message.get('attachments', []):
            if att.get('type', '').startswith('image/'):
                final_model = FIXED_VISION_MODEL
                try:
                    filename = Path(att['url']).name
                    attachment_path = CHATS_DIR / chat_id / ATTACHMENTS_DIR_NAME / filename
                    with open(attachment_path, 'rb') as img_file:
                        images_b64.append(base64.b64encode(img_file.read()).decode('utf-8'))
                except Exception as e:
                    print(f"Error reading attachment {att['url']}: {e}")
        if images_b64: 
            api_user_message['images'] = images_b64
            messages_for_api[-1] = api_user_message
    
    # THE FIX: This endpoint now streams the response
    try:
        stream = ollama.chat(model=final_model, messages=messages_for_api, stream=True)
        def generate():
            full_response_content = ""
            try:
                for chunk in stream:
                    if 'content' in chunk['message']:
                        content_piece = chunk['message']['content']
                        full_response_content += content_piece
                        yield content_piece
                
                # After streaming, update the history with the final message
                ai_message_dict = {
                    'role': 'assistant',
                    'content': full_response_content,
                    'model': final_model
                }
                
                # Reload chat data to prevent race conditions before saving
                current_chat_data = load_chat_history(chat_id)
                current_chat_data['messages'][msg_index] = ai_message_dict # Replace the old message
                save_chat_history(chat_id, current_chat_data)

            except Exception as e:
                print(f"Error during regeneration stream for chat {chat_id}: {e}")

        return Response(generate(), mimetype='text/plain')
    except Exception as e:
        traceback.print_exc()
        return Response(f"Ollama API Error: {e}", status=500)

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
        
    messages_for_api = chat_data['messages']
    
    last_user_msg = messages_for_api[-1]
    final_model = model
    if 'attachments' in last_user_msg:
        api_user_message = last_user_msg.copy()
        images_b64 = []
        for att in api_user_message.get('attachments', []):
            if att.get('type', '').startswith('image/'):
                final_model = FIXED_VISION_MODEL
                try:
                    filename = Path(att['url']).name
                    attachment_path = CHATS_DIR / chat_id / ATTACHMENTS_DIR_NAME / filename
                    with open(attachment_path, 'rb') as img_file:
                        images_b64.append(base64.b64encode(img_file.read()).decode('utf-8'))
                except Exception as e:
                    print(f"Error reading attachment {att['url']}: {e}")
        if images_b64: 
            api_user_message['images'] = images_b64
            messages_for_api[-1] = api_user_message

    try:
        response = ollama.chat(model=final_model, messages=messages_for_api)
        raw_ai_message = response['message']
        ai_message_dict = { 'role': raw_ai_message['role'], 'content': raw_ai_message['content'], 'model': final_model }
        
        chat_data['messages'].append(ai_message_dict)
        save_chat_history(chat_id, chat_data)
        
        return jsonify({"response": ai_message_dict})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Error during edit and regeneration: {e}"}), 500

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