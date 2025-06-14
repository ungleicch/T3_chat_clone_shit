document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const promptInput = document.getElementById('prompt-input');
    const mainModelSelectorContainer = document.getElementById('main-model-selector-container');
    const attachFileBtn = document.getElementById('attach-file-btn');
    const webSearchBtn = document.getElementById('web-search-btn');
    const fileInput = document.getElementById('file-input');
    const filePreviewArea = document.getElementById('file-preview-area');
    const searchThreadsInput = document.getElementById('search-threads-input');
    const stopGeneratingBtn = document.getElementById('stop-generating-btn');
    const sendBtn = document.getElementById('send-btn');

    // --- Global State ---
    let currentChatId = null;
    let attachedFiles = [];
    let currentAbortController = null;
    let editState = null;
    let availableModels = [];
    let selectedModel = null;
    let isWebSearchEnabled = false;

    // --- Icons ---
    const ICONS = {
        user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="1em" height="1em"><path fill="currentColor" d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512H418.3c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304H178.3z"/></svg>`,
        webSearch: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em"><path fill="currentColor" d="M352 256c0 22.2-1.2 43.6-3.3 64H163.3c-2.1-20.4-3.3-41.8-3.3-64s1.2-43.6 3.3-64H348.7c2.1 20.4 3.3 41.8 3.3 64zM256 32C132.3 32 32 132.3 32 256s100.3 224 224 224c17.1 0 33.6-1.9 49.4-5.4C337 409.7 415.8 320.8 416 216.3c0-17.1-1.9-33.6-5.4-49.4C476.9 130.1 387.9 51.3 283.4 51.4 274.3 38.6 265.4 32 256 32zM80 256c0-94 67.4-173.1 158.4-190.5C222.9 83.1 208 115.3 208 152c0 47.4 30.8 87.3 72.8 101.5c-4.1 24.3-9 47.9-14.7 70.5H163.3c-12.9-59.5-12.9-121.5 0-181H109.5C92.9 138.6 80 195.8 80 256zm185.3 162.5c18.3-14.1 31.3-35.3 35.8-59.5H240.3c-26.2 33.3-55.8 61.6-88.9 84.9b-.1 .1c-3.1 2.2-6.4 4.3-9.8 6.3c6.4 1.3 12.9 2.1 19.5 2.1c123.7 0 224-100.3 224-224c0-12.5-1-24.7-2.9-36.5C445.6 137.1 416 216.3 416 216.3v1c0 30.3-10.4 57.9-27.7 79.5c-17.5 21.8-40.3 38.8-66.4 49.3c-26.1 10.5-54.6 15.7-83.6 15.7c-11.8 0-23.4-1.1-34.7-3.3c3.6-2.1 7.1-4.4 10.5-6.9c28.1-20.1 52.7-45.1 73.2-73.2z"/></svg>`,
        edit: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 480.7c-3.2 10.8 7.2 21.2 18 18l120-35.4c14.1-4.2 27-11.8 37.4-22.2L421.7 220.3 291.7 90.3z"/></svg>`,
        delete: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>`,
        regenerate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160H336c-17.7 0-32 14.3-32 32s14.3 32 32 32H464c17.7 0 32-14.3 32-32V64c0-17.7-14.3-32-32-32s-32 14.3-32 32v51.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-17-17c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l17 17c37.5 37.5 98.3 37.5 135.8 0c17.6-17.6 30-38.1 37.8-59.8c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5z"/></svg>`
    };

    // --- Helper Functions ---
    const formatBytes = (bytes, decimals = 2) => {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };

    const generateModelAvatar = (modelName) => {
        let hash = 0;
        if (!modelName || modelName.length === 0) modelName = "default";
        for (let i = 0; i < modelName.length; i++) {
            hash = modelName.charCodeAt(i) + ((hash << 5) - hash);
            hash |= 0;
        }
        const hue = Math.abs(hash % 360);
        const saturation = 70 + (Math.abs(hash) % 10);
        const lightness = 40 + (Math.abs(hash) % 10);
        const color1 = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        const color2 = `hsl(${(hue + 40) % 360}, ${saturation}%, ${lightness - 10}%)`;
        const angle = Math.abs(hash % 360);
        return `<div class="model-avatar-inner" style="background: linear-gradient(${angle}deg, ${color1}, ${color2});"></div>`;
    };

    const setSelectedModel = (modelName) => {
        selectedModel = modelName;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'model-selector-button';
        button.title = `Change model (current: ${modelName})`;
        button.innerHTML = `
            <div class="model-avatar">${generateModelAvatar(modelName)}</div>
            <span class="model-name-display">${modelName}</span>
            <svg class="chevron-down" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg>
        `;
        button.onclick = (e) => {
            e.stopPropagation();
            showModelSelectorPopup(e.currentTarget, (newModel) => setSelectedModel(newModel));
        };
        mainModelSelectorContainer.innerHTML = '';
        mainModelSelectorContainer.appendChild(button);
    };

    const showModelSelectorPopup = (targetElement, onSelectCallback) => {
        document.querySelectorAll('.model-selector-popup').forEach(p => p.remove());
        const popup = document.createElement('div');
        popup.className = 'model-selector-popup';
        availableModels.forEach(model => {
            const item = document.createElement('div');
            item.className = 'model-popup-item';
            item.dataset.modelName = model.name;
            item.innerHTML = `
                <div class="model-avatar">${generateModelAvatar(model.name)}</div>
                <div class="model-info">
                    <span class="model-name">${model.name}</span>
                    <span class="model-details">${formatBytes(model.size)}</span>
                </div>
            `;
            item.onclick = () => { onSelectCallback(model.name); popup.remove(); };
            popup.appendChild(item);
        });
        document.body.appendChild(popup);
        const rect = targetElement.getBoundingClientRect();
        if (targetElement.closest('.message-actions')) {
            popup.style.right = `${window.innerWidth - rect.right}px`;
            popup.style.bottom = `${window.innerHeight - rect.top}px`;
        } else {
            popup.style.left = `${rect.left}px`;
            popup.style.bottom = `${window.innerHeight - rect.top + 10}px`;
        }
        popup.classList.add('visible');
        setTimeout(() => {
            document.addEventListener('click', function closePopup(e) {
                if (!popup.contains(e.target) && !targetElement.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', closePopup);
                }
            }, true);
        }, 0);
    };

    // --- Core Application Logic ---
    const init = () => {
        marked.setOptions({
            highlight: (code, lang) => {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            },
            langPrefix: 'hljs language-',
            gfm: true,
            breaks: true,
        });
        loadModels();
        loadChatList();
        setupEventListeners();
        renderWelcomeScreen();
    };

    const loadModels = async () => {
        try {
            const response = await fetch('/api/models');
            if (!response.ok) throw new Error((await response.json()).error || 'Failed to load models.');
            availableModels = await response.json();
            if (!availableModels || availableModels.length === 0) {
                mainModelSelectorContainer.innerHTML = '<div class="model-selector-button-placeholder">No Models</div>';
                promptInput.placeholder = "No models available. Please start Ollama.";
                sendBtn.disabled = true;
            } else {
                setSelectedModel(availableModels.find(m => m.name.includes("mistral"))?.name || availableModels[0].name);
                promptInput.placeholder = "Type your message here...";
                sendBtn.disabled = true;
            }
        } catch (error) {
            console.error('Error loading models:', error);
            mainModelSelectorContainer.innerHTML = '<div class="model-selector-button-placeholder">Error</div>';
            promptInput.placeholder = "Could not connect to Ollama.";
            sendBtn.disabled = true;
        }
    };
    
    const loadChatList = async () => {
        try {
            const response = await fetch('/api/chats');
            const chats = await response.json();
            chatList.innerHTML = '';
            chats.forEach(chat => addChatToList(chat.id, chat.title));
            updateActiveChatItem(currentChatId);
        } catch (error) { console.error('Error loading chat list:', error); }
    };
    
    const loadChatHistory = async (chatId) => {
        if (currentAbortController) currentAbortController.abort();
        if (currentChatId === chatId && chatWindow.innerHTML.trim() !== '' && !chatWindow.querySelector('.welcome-screen')) return;
        try {
            const response = await fetch(`/api/chat/${chatId}`);
            if (!response.ok) throw new Error('Chat not found');
            const chat = await response.json();
            currentChatId = chatId;
            chatWindow.innerHTML = '';
            chat.messages.forEach((msg, index) => renderMessage(msg, index));
            updateActiveChatItem(chatId);
            chatWindow.scrollTop = chatWindow.scrollHeight;
        } catch (error) {
            console.error('Error loading chat:', error);
            createNewChat();
            renderMessage({role: 'assistant', content: `**Error:** Could not load chat. ${error.message}`}, -1);
        }
    };

    const setupEventListeners = () => {
        newChatBtn.addEventListener('click', createNewChat);
        chatForm.addEventListener('submit', handleFormSubmit);
        promptInput.addEventListener('input', () => {
            autoResizeTextarea();
            sendBtn.disabled = promptInput.value.trim().length === 0 && attachedFiles.length === 0;
        });
        fileInput.addEventListener('change', handleFileSelection);
        searchThreadsInput.addEventListener('input', filterChatList);
        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleFormSubmit(e);
            }
        });
        chatList.addEventListener('click', (e) => {
            const chatItem = e.target.closest('.chat-list-item');
            if (!chatItem) return;
            const chatId = chatItem.dataset.chatId;
            if (e.target.closest('.delete-chat-btn')) {
                e.stopPropagation();
                deleteChat(chatId);
            } else {
                loadChatHistory(chatId);
            }
        });
        stopGeneratingBtn.addEventListener('click', () => {
            if (currentAbortController) currentAbortController.abort();
        });
        attachFileBtn.addEventListener('click', () => fileInput.click());
        webSearchBtn.addEventListener('click', () => {
            isWebSearchEnabled = !isWebSearchEnabled;
            webSearchBtn.classList.toggle('active', isWebSearchEnabled);
        });
    };

    const createNewChat = () => {
        if (currentAbortController) currentAbortController.abort();
        currentChatId = null;
        editState = null;
        promptInput.disabled = false;
        updateActiveChatItem(null);
        renderWelcomeScreen();
        clearFileInputs();
        promptInput.value = '';
        autoResizeTextarea();
        sendBtn.disabled = true;
        isWebSearchEnabled = false;
        webSearchBtn.classList.remove('active');
        promptInput.focus();
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        const prompt = promptInput.value.trim();
        const model = selectedModel;
        if ((!prompt && attachedFiles.length === 0) || !model) return;

        let finalPrompt = prompt;
        if (isWebSearchEnabled) {
            finalPrompt = `[Web Search Activated] ${prompt}`;
        }
        
        const userMessageForDisplay = {
            role: 'user',
            content: prompt,
            attachments: [],
            web_search_used: isWebSearchEnabled
        };
        
        promptInput.value = '';
        autoResizeTextarea();
        sendBtn.disabled = true;
        isWebSearchEnabled = false; 
        webSearchBtn.classList.remove('active');
        
        const formData = new FormData();
        formData.append('prompt', finalPrompt);
        formData.append('model', model);
        attachedFiles.forEach(file => formData.append('files', file));
        clearFileInputs();
        
        const endpoint = currentChatId ? `/api/chat/${currentChatId}/stream` : '/api/chat/stream';
        
        await executeStream(endpoint, 'POST', formData, userMessageForDisplay);
    };

    async function executeStream(endpoint, method, body, userMessageForDisplay = null) {
        if (currentAbortController) currentAbortController.abort();
        currentAbortController = new AbortController();
        sendBtn.classList.add('hidden');
        stopGeneratingBtn.classList.remove('hidden');

        if (chatWindow.querySelector('.welcome-screen')) {
            chatWindow.innerHTML = '';
        }
        
        let aiMessageContainer = null;
        let finalModel = selectedModel;
        
        try {
            const response = await fetch(endpoint, {
                method: method,
                body: body,
                signal: currentAbortController.signal,
                headers: body instanceof FormData ? {} : {'Content-Type': 'application/json'}
            });

            if (!response.ok) throw new Error(await response.text());

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                
                if (userMessageForDisplay && buffer.includes('\n---\n')) {
                    const parts = buffer.split('\n---\n');
                    const jsonPart = parts[0];
                    buffer = parts.slice(1).join('\n---\n');
                    
                    try {
                        const initialData = JSON.parse(jsonPart);
                        currentChatId = initialData.chatId;
                        userMessageForDisplay.attachments = initialData.user_message.attachments;
                        
                        if (!document.querySelector(`.chat-list-item[data-chat-id="${currentChatId}"]`)) {
                            addChatToList(currentChatId, "New Chat", true);
                             fetch(`/api/chat/${currentChatId}/generate_title`, { method: 'POST' })
                                .then(res => res.json())
                                .then(data => { if (data.newTitle) document.querySelector(`.chat-list-item[data-chat-id="${data.chatId}"] .chat-title`).textContent = data.newTitle; })
                                .catch(err => console.error("Could not generate title:", err));
                        }
                        updateActiveChatItem(currentChatId);

                        renderMessage(userMessageForDisplay, document.querySelectorAll('.message-container').length);
                        chatWindow.scrollTop = chatWindow.scrollHeight;
                        userMessageForDisplay = null;
                    } catch (e) {
                         userMessageForDisplay = null;
                    }
                }

                if (!userMessageForDisplay) {
                    if (!aiMessageContainer) {
                        const modelInBody = (body instanceof FormData) ? body.get('model') : (JSON.parse(body).model);
                        finalModel = modelInBody || selectedModel;
                        aiMessageContainer = renderMessage({ role: 'assistant', content: '', model: finalModel }, document.querySelectorAll('.message-container').length, true);
                    }
                    const isScrolledToBottom = chatWindow.scrollHeight - chatWindow.clientHeight <= chatWindow.scrollTop + 50;
                    aiMessageContainer.querySelector('.message-content').innerHTML = marked.parse(buffer + '<span class="loading-pulse"></span>');
                    if (isScrolledToBottom) {
                        chatWindow.scrollTop = chatWindow.scrollHeight;
                    }
                }
            }

            if (aiMessageContainer) {
                 const isScrolledToBottom = chatWindow.scrollHeight - chatWindow.clientHeight <= chatWindow.scrollTop + 50;
                 aiMessageContainer.remove();
                 const finalMessage = { role: 'assistant', content: buffer, model: finalModel };
                 const finalElement = renderMessage(finalMessage, document.querySelectorAll('.message-container').length);
                 if (isScrolledToBottom) {
                     finalElement.scrollIntoView({ behavior: 'auto', block: 'end' });
                 }
            }

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error("Stream execution error:", error);
                if (aiMessageContainer) aiMessageContainer.remove();
                renderMessage({role: 'assistant', content: `**Error:** ${error.message}`}, -1);
            }
        } finally {
            sendBtn.classList.remove('hidden');
            stopGeneratingBtn.classList.add('hidden');
            currentAbortController = null;
        }
    }
    
    const handleInlineEditSubmit = async (chatId, msgIndex, newPrompt) => {
        const model = selectedModel;
        if (!newPrompt || !model) return;

        promptInput.disabled = false;
        
        const originalMessageContainer = document.querySelector(`.message-container[data-msg-index="${msgIndex}"]`);
        if (originalMessageContainer) {
            originalMessageContainer.classList.remove('editing');
            let attachmentsHTML = originalMessageContainer.querySelector('.attachments-container')?.outerHTML || '';
            originalMessageContainer.querySelector('.message-content').innerHTML = attachmentsHTML + `<p>${newPrompt.replace(/\n/g, '<br>')}</p>`;
        }
        
        const allMessages = Array.from(document.querySelectorAll('.message-container'));
        const messagesToRemove = allMessages.slice(msgIndex + 1);
        messagesToRemove.forEach(msg => msg.remove());
        
        const aiLoadingMessage = renderMessage({ role: 'assistant', content: '', model: model }, msgIndex + 1, true);

        try {
            const response = await fetch(`/api/chat/${chatId}/edit_and_regenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_prompt: newPrompt, msg_index: msgIndex, model: model }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Failed to edit and regenerate.");

            aiLoadingMessage.remove();
            renderMessage(data.response, msgIndex + 1);

        } catch (error) {
            console.error('Edit submission error:', error);
            aiLoadingMessage.remove();
            renderMessage({ role: 'assistant', content: `**Error:** ${error.message}` }, msgIndex + 1);
        } finally {
            editState = null;
        }
    };
    
    const handleEditMessage = (chatId, msgIndex) => {
        if (editState) {
            const oldEditor = document.querySelector('.inline-editor');
            if (oldEditor) {
                const oldContainer = oldEditor.closest('.message-container');
                loadChatHistory(currentChatId).then(() => {
                    oldContainer.classList.remove('editing');
                });
            }
        }

        const messageContainer = document.querySelector(`.message-container[data-msg-index="${msgIndex}"]`);
        const contentDiv = messageContainer.querySelector('.message-content');
        if (!contentDiv) return;

        const attachmentsDivHTML = contentDiv.querySelector('.attachments-container')?.outerHTML || '';
        const originalP = contentDiv.querySelector('p');
        const currentText = (originalP ? originalP.innerHTML.replace(/<br\s*\/?>/ig, '\n') : '').trim();
        
        const editorTextarea = document.createElement('textarea');
        editorTextarea.className = 'inline-editor';
        editorTextarea.value = currentText;
        
        const autoResizeInline = () => {
            editorTextarea.style.height = 'auto';
            editorTextarea.style.height = `${editorTextarea.scrollHeight}px`;
        };
        editorTextarea.addEventListener('input', autoResizeInline);
        
        contentDiv.innerHTML = attachmentsDivHTML;
        contentDiv.appendChild(editorTextarea);
        
        setTimeout(autoResizeInline, 0);
        editorTextarea.focus();
        editorTextarea.select();

        promptInput.disabled = true;
        messageContainer.classList.add('editing');
        editState = { chatId, msgIndex };
        
        editorTextarea.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleInlineEditSubmit(chatId, msgIndex, editorTextarea.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                loadChatHistory(currentChatId);
                promptInput.disabled = false;
                editState = null;
            }
        };
    };

    const handleDeleteMessage = async (chatId, msgIndex) => {
        if (!confirm('This will delete the message and its conversational partner. Are you sure?')) return;
        try {
            const response = await fetch(`/api/chat/${chatId}/message/${msgIndex}`, { method: 'DELETE' });
            if (!response.ok) throw new Error((await response.json()).error || 'Failed to delete message.');
            loadChatHistory(chatId);
        } catch (error) {
            console.error(error);
            alert(error.message);
        }
    };

    const handleRegenerateMessage = async (chatId, msgIndex, modelToUse = null) => {
        const originalModel = modelToUse || selectedModel;
        
        const allMessages = Array.from(document.querySelectorAll('.message-container'));
        const messagesToRemove = allMessages.slice(msgIndex);
        messagesToRemove.forEach(msg => msg.remove());
        
        const payload = JSON.stringify({ model: originalModel, msg_index: msgIndex });
        const endpoint = `/api/chat/${chatId}/regenerate`;
        
        // THE FIX: Wrap the call in a try/finally to ensure UI resets
        try {
            await executeStream(endpoint, 'POST', payload, null);
        } catch (e) {
            console.error("Error during regeneration:", e);
        } finally {
            // This now ensures the buttons are always reset even if the user aborts
            sendBtn.classList.remove('hidden');
            stopGeneratingBtn.classList.add('hidden');
            currentAbortController = null;
        }
    };
    
    const renderMessage = (msg, index, isLoading = false) => {
        const { role, content, attachments, model, web_search_used } = msg;
        const container = document.createElement('div');
        container.className = `message-container role-${role}`;
        container.dataset.msgIndex = index;

        const profilePic = document.createElement('div');
        profilePic.className = 'profile-pic';
        profilePic.innerHTML = role === 'assistant' ? generateModelAvatar(model || 'assistant') : ICONS.user;
        
        const messageBubble = document.createElement('div');
        messageBubble.className = 'message-bubble';
        
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        
        let senderNameHTML = `<span class="sender-name">${role === 'user' ? 'You' : 'Assistant'}</span>`;
        if (web_search_used) {
            senderNameHTML += `<span class="web-search-indicator" title="Web Search was used for this query">${ICONS.webSearch}</span>`;
        }
        messageHeader.innerHTML = senderNameHTML;

        if (role === 'assistant' && model) {
            messageHeader.innerHTML += `<span class="model-tag">${model}</span>`;
        }

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        let attachmentsHTML = '';
        if (attachments && attachments.length > 0) {
            attachmentsHTML += '<div class="attachments-container">';
            attachments.forEach(att => {
                const src = att.url || '#';
                if (att.type && att.type.startsWith('image/')) {
                    attachmentsHTML += `<a href="${src}" target="_blank" title="View full image: ${att.original_filename}" class="attachment-item image-attachment"><img src="${src}" alt="${att.original_filename}" loading="lazy"></a>`;
                } else {
                    attachmentsHTML += `<a href="${src}" target="_blank" class="attachment-item file-attachment"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="1em" height="1em"><path fill="currentColor" d="M0 64C0 28.7 28.7 0 64 0H224V128c0 17.7 14.3 32 32 32H384V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V64zm384 64H256V0L384 128z"/></svg><span>${att.original_filename}</span></a>`;
                }
            });
            attachmentsHTML += '</div>';
        }
        
        let mainContentHTML = '';
        if (isLoading) {
            mainContentHTML = '<p><span class="loading-pulse"></span></p>';
        } else {
            let processedContent = content || "";
            processedContent = role === 'assistant' ? marked.parse(processedContent) : `<p>${processedContent.replace(/</g, "<").replace(/>/g, ">").replace(/\n/g, '<br>')}</p>`;
            mainContentHTML = processedContent;
        }
        messageContent.innerHTML = attachmentsHTML + mainContentHTML;

        if (!isLoading) {
            messageContent.querySelectorAll('pre').forEach(pre => {
                const copyButton = document.createElement('button');
                copyButton.className = 'copy-code-btn';
                copyButton.textContent = 'Copy';
                copyButton.onclick = () => {
                    const code = pre.querySelector('code').innerText;
                    navigator.clipboard.writeText(code).then(() => {
                        copyButton.textContent = 'Copied!';
                        setTimeout(() => { copyButton.textContent = 'Copy'; }, 2000);
                    });
                };
                pre.appendChild(copyButton);
            });
        }
        
        messageBubble.appendChild(messageHeader);
        messageBubble.appendChild(messageContent);
        
        if (!isLoading && index >= 0) {
            const messageActions = document.createElement('div');
            messageActions.className = 'message-actions';
            if (role === 'assistant') {
                const regenerateGroup = document.createElement('div');
                regenerateGroup.className = 'regenerate-group';
                const regenerateBtn = document.createElement('button');
                regenerateBtn.className = 'action-btn';
                regenerateBtn.title = 'Regenerate';
                regenerateBtn.innerHTML = ICONS.regenerate;
                regenerateBtn.onclick = () => handleRegenerateMessage(currentChatId, index, model);
                const optionsBtn = document.createElement('button');
                optionsBtn.className = 'action-btn';
                optionsBtn.title = 'Regenerate with another model';
                optionsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em"><path fill="currentColor" d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg>`;
                optionsBtn.onclick = (e) => {
                    e.stopPropagation();
                    showModelSelectorPopup(e.currentTarget, (newModel) => handleRegenerateMessage(currentChatId, index, newModel));
                };
                regenerateGroup.appendChild(regenerateBtn);
                regenerateGroup.appendChild(optionsBtn);
                messageActions.appendChild(regenerateGroup);
            } else {
                const editBtn = document.createElement('button');
                editBtn.className = 'action-btn';
                editBtn.title = 'Edit';
                editBtn.innerHTML = ICONS.edit;
                editBtn.onclick = () => handleEditMessage(currentChatId, index);
                messageActions.appendChild(editBtn);
            }
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'action-btn';
            deleteBtn.title = 'Delete';
            deleteBtn.innerHTML = ICONS.delete;
            deleteBtn.onclick = () => handleDeleteMessage(currentChatId, index);
            messageActions.appendChild(deleteBtn);
            messageBubble.appendChild(messageActions);
        }

        container.appendChild(profilePic);
        container.appendChild(messageBubble);

        const existingMsg = document.querySelector(`.message-container[data-msg-index="${index}"]`);
        if (existingMsg) {
            existingMsg.replaceWith(container);
        } else {
            chatWindow.appendChild(container);
        }
        
        return container;
    };
    
    const addChatToList = (id, title, prepend = false) => {
        const existingItem = document.querySelector(`.chat-list-item[data-chat-id="${id}"]`);
        if (existingItem) {
            existingItem.querySelector('.chat-title').textContent = title;
            return;
        }
        const li = document.createElement('li');
        li.className = 'chat-list-item';
        li.dataset.chatId = id;
        const titleSpan = document.createElement('span');
        titleSpan.className = 'chat-title';
        titleSpan.textContent = title;
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-chat-btn';
        deleteButton.title = 'Delete Chat';
        deleteButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="1em" height="1em"><path fill="currentColor" d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>`;
        li.appendChild(titleSpan);
        li.appendChild(deleteButton);
        if (prepend) { chatList.prepend(li); } else { chatList.appendChild(li); }
    };

    const updateActiveChatItem = (chatId) => {
        document.querySelectorAll('.chat-list-item').forEach(item => {
            item.classList.toggle('active', item.dataset.chatId === chatId);
        });
    };

    const renderWelcomeScreen = () => {
        chatWindow.innerHTML = `
            <div class="welcome-screen">
                <h1>How can I help you?</h1>
                <div class="suggestion-pills">
                    <div class="suggestion-pill" data-prompt="Create a story">✨ Create a story</div>
                    <div class="suggestion-pill" data-prompt="Explore ideas about space travel">🔍 Explore ideas</div>
                    <div class="suggestion-pill" data-prompt="Code a function in python">💻 Code a function</div>
                    <div class="suggestion-pill" data-prompt="Learn something new about ancient Rome">🎓 Learn something new</div>
                </div>
                <div class="example-prompts">
                    <div class="example-prompt">Explain how a black hole works</div>
                    <div class="example-prompt">Write a Python script to sort a list of dictionaries</div>
                    <div class="example-prompt">What are the pros and cons of React vs. Vue?</div>
                    <div class="example-prompt">Tell me a joke about programming</div>
                </div>
            </div>`;
            
        chatWindow.querySelectorAll('.example-prompt, .suggestion-pill').forEach(el => {
            el.addEventListener('click', () => {
                promptInput.value = el.dataset.prompt || el.textContent;
                promptInput.focus();
                autoResizeTextarea();
                sendBtn.disabled = false;
            });
        });
    };

    const filterChatList = () => {
        const query = searchThreadsInput.value.toLowerCase();
        document.querySelectorAll('.chat-list-item').forEach(item => {
            const title = item.querySelector('.chat-title').textContent.toLowerCase();
            item.style.display = title.includes(query) ? 'flex' : 'none';
        });
    };
    
    const autoResizeTextarea = () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = `${Math.min(promptInput.scrollHeight, 200)}px`;
    };

    const handleFileSelection = (e) => {
        Array.from(e.target.files).forEach(file => attachedFiles.push(file));
        renderFilePreview();
        sendBtn.disabled = false;
        fileInput.value = '';
    };
    
    const renderFilePreview = () => {
        filePreviewArea.innerHTML = '';
        if (attachedFiles.length > 0) {
            filePreviewArea.style.display = 'flex';
        } else {
            filePreviewArea.style.display = 'none';
        }
        
        attachedFiles.forEach((file, index) => {
            const fileEl = document.createElement('div');
            fileEl.className = 'file-preview';
            const fileNameSpan = document.createElement('span');
            fileNameSpan.textContent = file.name;
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-file-btn';
            removeBtn.title = 'Remove file';
            removeBtn.innerHTML = '×';
            removeBtn.addEventListener('click', () => {
                attachedFiles.splice(index, 1);
                renderFilePreview();
                sendBtn.disabled = promptInput.value.trim().length === 0 && attachedFiles.length === 0;
            });
            fileEl.appendChild(fileNameSpan);
            fileEl.appendChild(removeBtn);
            filePreviewArea.appendChild(fileEl);
        });
    };

    const clearFileInputs = () => {
        attachedFiles = [];
        renderFilePreview();
    };

    const deleteChat = async (chatId) => {
        if (!confirm('Are you sure you want to permanently delete this chat?')) return;
        try {
            const response = await fetch(`/api/chat/${chatId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error((await response.json()).error || 'Failed to delete chat.');
            document.querySelector(`.chat-list-item[data-chat-id="${chatId}"]`).remove();
            if (currentChatId === chatId) createNewChat();
        } catch (error) {
            console.error('Error deleting chat:', error);
            alert(error.message);
        }
    };

    init();
});