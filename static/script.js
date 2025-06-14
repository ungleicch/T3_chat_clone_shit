// --- Local AI Chat Frontend ---
// This script powers the entire user interface for the local AI chat.
// It communicates with the Flask backend, handles real-time message streaming,
// manages chat history, file uploads, and all user interactions.

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element References ---
    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const promptInput = document.getElementById('prompt-input');
    const mainModelSelectorContainer = document.getElementById('main-model-selector-container');
    const attachFileBtn = document.getElementById('attach-file-btn');
    const fileInput = document.getElementById('file-input');
    const filePreviewArea = document.getElementById('file-preview-area');
    const searchThreadsInput = document.getElementById('search-threads-input');
    const stopGeneratingBtn = document.getElementById('stop-generating-btn');
    const sendBtn = document.getElementById('send-btn');
    const webSearchBtn = document.getElementById('web-search-btn');

    // --- Global State Management ---
    let currentChatId = null;
    let attachedFiles = [];
    let currentAbortController = null;
    let editState = null;
    let availableModels = [];
    let selectedModel = null;
    let isWebSearchEnabled = false;

    // --- Icon Definitions ---
    const ICONS = {
        user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="1em" height="1em"><path fill="currentColor" d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512H418.3c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304H178.3z"/></svg>`,
        edit: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 480.7c-3.2 10.8 7.2 21.2 18 18l120-35.4c14.1-4.2 27-11.8 37.4-22.2L421.7 220.3 291.7 90.3z"/></svg>`,
        delete: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64s14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>`,
        regenerate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160H336c-17.7 0-32 14.3-32 32s14.3 32 32 32H464c17.7 0 32-14.3 32-32V64c0-17.7-14.3-32-32-32s-32 14.3-32 32v51.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-17-17c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l17 17c37.5 37.5 98.3 37.5 135.8 0c17.6-17.6 30-38.1 37.8-59.8c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5z"/></svg>`
    };

    // --- Initialization and Event Setup ---
    const init = () => {
        marked.setOptions({
            highlight: (code, lang) => {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            },
            gfm: true,
            breaks: true,
        });
        loadModels();
        loadChatList();
        setupEventListeners();
        renderWelcomeScreen();
    };

    const setupEventListeners = () => {
        newChatBtn.addEventListener('click', createNewChat);
        chatForm.addEventListener('submit', handleFormSubmit);
        promptInput.addEventListener('input', autoResizeTextarea);
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
        webSearchBtn.addEventListener('click', toggleWebSearch);
        chatWindow.addEventListener('click', handleChatWindowClick);
    };

    // --- UI Rendering and Manipulation ---
    const generateModelAvatar = (modelName) => {
        let hash = 0;
        if (!modelName || modelName.length === 0) modelName = "default";
        for (let i = 0; i < modelName.length; i++) {
            hash = modelName.charCodeAt(i) + ((hash << 5) - hash);
            hash |= 0;
        }
        const hue = Math.abs(hash % 360);
        const color1 = `hsl(${hue}, 70%, 40%)`;
        const color2 = `hsl(${(hue + 40) % 360}, 70%, 30%)`;
        return `<div class="model-avatar-inner" style="background: linear-gradient(45deg, ${color1}, ${color2});"></div>`;
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
            showModelSelectorPopup(e.currentTarget, newModel => setSelectedModel(newModel));
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
            item.innerHTML = `<div class="model-avatar">${generateModelAvatar(model.name)}</div><span class="model-name">${model.name}</span>`;
            item.onclick = () => { onSelectCallback(model.name); popup.remove(); };
            popup.appendChild(item);
        });
        document.body.appendChild(popup);
        const rect = targetElement.getBoundingClientRect();
        popup.style.left = `${rect.left}px`;
        popup.style.bottom = `${window.innerHeight - rect.top + 10}px`;
        popup.classList.add('visible');
        setTimeout(() => {
            document.addEventListener('click', function closePopup(e) {
                if (!popup.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', closePopup);
                }
            }, { once: true });
        }, 0);
    };

    const renderMessage = (msg, index, isLoading = false) => {
        const { role, content, attachments, model } = msg;
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
        messageHeader.innerHTML = `<span class="sender-name">${role === 'user' ? 'You' : 'Assistant'}</span>`;
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
                    // THE FIX: New HTML structure for clickable thumbnails
                    attachmentsHTML += `
                        <div class="attachment-item image-thumbnail">
                            <a href="${src}" target="_blank" title="View full image: ${att.original_filename}">
                                <img src="${src}" alt="${att.original_filename}" loading="lazy">
                            </a>
                        </div>`;
                } else {
                    attachmentsHTML += `<a href="${src}" target="_blank" class="attachment-item file-attachment"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="1em" height="1em"><path fill="currentColor" d="M0 64C0 28.7 28.7 0 64 0H224V128c0 17.7 14.3 32 32 32H384V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V64zm384 64H256V0L384 128z"/></svg><span>${att.original_filename}</span></a>`;
                }
            });
            attachmentsHTML += '</div>';
        }

        if (isLoading) {
            messageContent.innerHTML = '<p><span class="loading-pulse"></span></p>';
        } else {
            let processedContent = (content || "").replace(/\[Web Search Activated\]/g, '').trim();
            // Wrap text in <p> tags to separate from attachments, unless it's empty
            let textHTML = processedContent ? marked.parse(processedContent) : '';
            
            // THE FIX: Render text BEFORE attachments
            messageContent.innerHTML = textHTML + attachmentsHTML;
        }

        if (!isLoading) {
            messageContent.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
            // Copy button is now added via delegated event listener
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
                    showModelSelectorPopup(e.currentTarget, newModel => handleRegenerateMessage(currentChatId, index, newModel));
                };
                regenerateGroup.appendChild(regenerateBtn);
                regenerateGroup.appendChild(optionsBtn);
                messageActions.appendChild(regenerateGroup);
            } else { // role === 'user'
                const editBtn = document.createElement('button');
                editBtn.className = 'action-btn';
                editBtn.title = 'Edit and Regenerate';
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
    
    // THE FIX: Logic for adding copy buttons moved to after rendering is complete
    const postRenderSetup = (container) => {
        container.querySelectorAll('pre:not(.has-copy-btn)').forEach(pre => {
            const copyButton = document.createElement('button');
            copyButton.className = 'copy-code-btn';
            copyButton.textContent = 'Copy';
            pre.appendChild(copyButton);
            pre.classList.add('has-copy-btn');
        });
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
        li.innerHTML = `<span class="chat-title">${title}</span><button class="delete-chat-btn" title="Delete Chat">${ICONS.delete}</button>`;
        if (prepend) {
            chatList.prepend(li);
        } else {
            chatList.appendChild(li);
        }
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
            </div>`;
        
        chatWindow.querySelectorAll('.suggestion-pill').forEach(el => {
            el.addEventListener('click', () => {
                promptInput.value = el.dataset.prompt || el.textContent;
                promptInput.focus();
                autoResizeTextarea();
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

    // --- Core Logic and API Communication ---
    const loadModels = async () => {
        try {
            const response = await fetch('/api/models');
            if (!response.ok) throw new Error('Failed to load models');
            availableModels = await response.json();
            if (availableModels.length > 0) {
                setSelectedModel(availableModels[0].name);
                sendBtn.disabled = false;
                promptInput.placeholder = "Type your message here...";
            } else {
                mainModelSelectorContainer.innerHTML = '<div class="model-selector-button-placeholder">None</div>';
                promptInput.placeholder = "No models available. Please start Ollama.";
                sendBtn.disabled = true;
            }
        } catch (error) {
            console.error('Error loading models:', error);
            mainModelSelectorContainer.innerHTML = '<div class="model-selector-button-placeholder">Error</div>';
            promptInput.placeholder = "Could not connect to Ollama.";
        }
    };

    const loadChatList = async () => {
        try {
            const chats = await (await fetch('/api/chats')).json();
            chatList.innerHTML = '';
            chats.forEach(chat => addChatToList(chat.id, chat.title));
            updateActiveChatItem(currentChatId);
        } catch (error) {
            console.error('Error loading chat list:', error);
        }
    };

    const loadChatHistory = async (chatId) => {
        if (currentAbortController) currentAbortController.abort();
        if (currentChatId === chatId && !chatWindow.querySelector('.welcome-screen')) return;
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
            createNewChat(); // Reset to a clean state
            alert(`Error loading chat: ${error.message}`);
        }
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        if (editState) {
            await handleEditSubmit();
            return;
        }

        let prompt = promptInput.value.trim();
        if ((!prompt && attachedFiles.length === 0) || !selectedModel) return;

        currentAbortController = new AbortController();
        sendBtn.classList.add('hidden');
        stopGeneratingBtn.classList.remove('hidden');

        if (isWebSearchEnabled) prompt = `[Web Search Activated] ${prompt}`;

        const formData = new FormData();
        formData.append('model', selectedModel);
        formData.append('prompt', prompt);
        attachedFiles.forEach(file => formData.append('files', file));
        
        const endpoint = currentChatId ? `/api/chat/${currentChatId}/stream` : '/api/chat/stream';
        if (chatWindow.querySelector('.welcome-screen')) chatWindow.innerHTML = '';

        clearFileInputs();
        promptInput.value = '';
        autoResizeTextarea();

        try {
            const response = await fetch(endpoint, { method: 'POST', body: formData, signal: currentAbortController.signal });
            if (!response.ok) throw new Error(await response.text());
            await processStream(response, !currentChatId);
        } catch (error) {
            if (error.name !== 'AbortError') {
                renderMessage({ role: 'assistant', content: `**Error:** ${error.message}` }, -1);
            }
        } finally {
            sendBtn.classList.remove('hidden');
            stopGeneratingBtn.classList.add('hidden');
            currentAbortController = null;
        }
    };

    const processStream = async (response, isNewChat) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const separator = '\n---\n';
        let initialDataHandled = false;
        let aiMessageContainer, contentDiv;

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                if (!initialDataHandled && buffer.includes(separator)) {
                    const parts = buffer.split(separator, 2);
                    const initialJson = parts[0];
                    buffer = parts[1] || '';
                    try {
                        const data = JSON.parse(initialJson);
                        renderMessage(data.user_message, document.querySelectorAll('.message-container').length);
                        if (isNewChat) {
                            currentChatId = data.chatId;
                            addChatToList(data.chatId, "New Chat", true);
                            updateActiveChatItem(currentChatId);
                            fetch(`/api/chat/${data.chatId}/generate_title`, { method: 'POST' })
                                .then(res => res.json())
                                .then(titleData => {
                                    if (titleData.newTitle) {
                                        const el = document.querySelector(`.chat-list-item[data-chat-id="${titleData.chatId}"] .chat-title`);
                                        if (el) el.textContent = titleData.newTitle;
                                    }
                                });
                        }
                        aiMessageContainer = renderMessage({ role: 'assistant', content: '', model: selectedModel }, document.querySelectorAll('.message-container').length, true);
                        contentDiv = aiMessageContainer.querySelector('.message-content');
                        initialDataHandled = true;
                    } catch (e) { console.error("Failed to parse initial data:", e); }
                }

                if (initialDataHandled) {
                    contentDiv.innerHTML = marked.parse(buffer + '<span class="loading-pulse"></span>');
                    chatWindow.scrollTop = chatWindow.scrollHeight;
                }
            }
        } catch (error) {
            if (error.name !== 'AbortError') console.error("Stream reading error:", error);
        } finally {
            if (aiMessageContainer) {
                const finalContent = buffer + (currentAbortController?.signal.aborted ? "\n\n*(Generation stopped by user)*" : "");
                renderMessage({ role: 'assistant', content: finalContent, model: selectedModel }, parseInt(aiMessageContainer.dataset.msgIndex));
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
        }
    };
    
    const handleChatWindowClick = (e) => {
        const target = e.target;
        if (target.classList.contains('copy-code-btn')) {
            const pre = target.closest('pre');
            if (pre) {
                const codeBlock = pre.querySelector('code');
                if (codeBlock) {
                    navigator.clipboard.writeText(codeBlock.innerText).then(() => {
                        target.textContent = 'Copied!';
                        setTimeout(() => { target.textContent = 'Copy'; }, 2000);
                    }).catch(err => {
                        console.error('Failed to copy text: ', err);
                        target.textContent = 'Error';
                    });
                }
            }
        }
    };

    const handleRegenerateMessage = async (chatId, msgIndex, modelToUse) => {
        currentAbortController = new AbortController();
        sendBtn.classList.add('hidden');
        stopGeneratingBtn.classList.remove('hidden');
        
        document.querySelectorAll(`.message-container[data-msg-index="${msgIndex}"]`).forEach(el => el.remove());
        
        const endpoint = `/api/chat/${chatId}/regenerate`;
        const model = modelToUse || selectedModel;
        const payload = { model: model, msg_index: msgIndex };
        const aiMessageContainer = renderMessage({ role: 'assistant', content: '', model: model }, msgIndex, true);
        const contentDiv = aiMessageContainer.querySelector('.message-content');
        let buffer = '';

        try {
            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: currentAbortController.signal });
            if (!response.ok) throw new Error(await response.text());
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while(true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                contentDiv.innerHTML = marked.parse(buffer + '<span class="loading-pulse"></span>');
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
        } catch (error) {
            if (error.name !== 'AbortError') buffer = `**Error regenerating response:** ${error.message}`;
        } finally {
            const finalContent = buffer + (currentAbortController?.signal.aborted ? "\n\n*(Generation stopped by user)*" : "");
            renderMessage({ role: 'assistant', content: finalContent, model: model }, msgIndex);
            sendBtn.classList.remove('hidden');
            stopGeneratingBtn.classList.add('hidden');
            currentAbortController = null;
        }
    };
    
    const handleEditMessage = (chatId, msgIndex) => {
        const messageContainer = document.querySelector(`.message-container[data-msg-index="${msgIndex}"]`);
        const contentDiv = messageContainer.querySelector('.message-content');
        if (!contentDiv) return;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentDiv.innerHTML.replace(/<br\s*\/?>/ig, '\n');
        const currentText = (tempDiv.textContent || tempDiv.innerText || "").replace(/\[Web Search Activated\]/g, '').trim();

        promptInput.value = currentText;
        promptInput.focus();
        autoResizeTextarea();

        editState = { chatId, msgIndex };
        sendBtn.innerHTML = ICONS.regenerate;
        sendBtn.title = "Edit and Resubmit";
    };
    
    const handleEditSubmit = async () => {
        const newPrompt = promptInput.value.trim();
        if (!newPrompt || !selectedModel || !editState) return;

        currentAbortController = new AbortController();
        sendBtn.classList.add('hidden');
        stopGeneratingBtn.classList.remove('hidden');

        document.querySelectorAll(`.message-container[data-msg-index]`).forEach(el => {
            if (parseInt(el.dataset.msgIndex) > editState.msgIndex) el.remove();
        });

        const userMsgContainer = document.querySelector(`.message-container[data-msg-index="${editState.msgIndex}"]`);
        if (userMsgContainer) {
            const contentDiv = userMsgContainer.querySelector('.message-content');
            if(contentDiv) contentDiv.innerHTML = marked.parse(newPrompt);
        }

        promptInput.value = '';
        autoResizeTextarea();
        sendBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M429.6 92.1c4.9-11.9 2.1-25.6-7-34.7s-22.8-11.9-34.7-7l-352 144c-14.2 5.8-22.2 20.8-19.3 35.8s16.1 25.8 31.4 25.8H224V432c0 15.3 10.8 28.4 25.8 31.4s30-5.1 35.8-19.3l144-352z"/></svg>`;
        sendBtn.title = "Send";
        
        try {
            const endpoint = `/api/chat/${editState.chatId}/edit_and_regenerate`;
            const payload = { new_prompt: newPrompt, msg_index: editState.msgIndex, model: selectedModel };
            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: currentAbortController.signal });
            if (!response.ok) throw new Error(await response.text());
            
            await processStream(response, false);

        } catch (error) {
            if (error.name !== 'AbortError') {
                 await loadChatHistory(editState.chatId);
                 alert(`Error during edit: ${error.message}`);
            }
        } finally {
            editState = null;
            stopGeneratingBtn.classList.add('hidden');
            sendBtn.classList.remove('hidden');
            currentAbortController = null;
        }
    };
    
    const handleDeleteMessage = async (chatId, msgIndex) => {
        if (!confirm('This will delete the message and any subsequent assistant response. Are you sure?')) return;
        try {
            const response = await fetch(`/api/chat/${chatId}/message/${msgIndex}`, { method: 'DELETE' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to delete message.');
            
            chatWindow.innerHTML = '';
            data.remaining_messages.forEach((msg, index) => renderMessage(msg, index));
            if (data.remaining_messages.length === 0) renderWelcomeScreen();

        } catch (error) {
            console.error(error);
            alert(error.message);
        }
    };

    const createNewChat = () => {
        if (currentAbortController) currentAbortController.abort();
        currentChatId = null;
        editState = null;
        isWebSearchEnabled = false;
        webSearchBtn.classList.remove('active');
        attachedFiles = [];
        updateActiveChatItem(null);
        renderWelcomeScreen();
        clearFileInputs();
        promptInput.value = '';
        autoResizeTextarea();
        promptInput.focus();
    };

    const toggleWebSearch = () => {
        isWebSearchEnabled = !isWebSearchEnabled;
        webSearchBtn.classList.toggle('active', isWebSearchEnabled);
    };

    const autoResizeTextarea = () => {
        promptInput.style.height = 'auto';
        const newHeight = Math.min(promptInput.scrollHeight, 200);
        promptInput.style.height = `${newHeight}px`;
    };

    const handleFileSelection = (e) => {
        Array.from(e.target.files).forEach(file => attachedFiles.push(file));
        renderFilePreview();
        fileInput.value = ''; 
    };

    const renderFilePreview = () => {
        filePreviewArea.innerHTML = '';
        filePreviewArea.style.display = attachedFiles.length > 0 ? 'flex' : 'none';
        
        attachedFiles.forEach((file, index) => {
            const fileEl = document.createElement('div');
            fileEl.className = 'file-preview';
            fileEl.innerHTML = `<span>${file.name}</span><button class="remove-file-btn" title="Remove file">✖</button>`;
            fileEl.querySelector('.remove-file-btn').addEventListener('click', () => {
                attachedFiles.splice(index, 1);
                renderFilePreview();
            });
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
    
    // Start the application
    init();
});