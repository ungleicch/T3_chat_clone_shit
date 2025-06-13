document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const chatList = document.getElementById('chat-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const promptInput = document.getElementById('prompt-input');
    const modelSelector = document.getElementById('model-selector');
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    const filePreviewArea = document.getElementById('file-preview-area');
    const searchThreadsInput = document.getElementById('search-threads-input');
    const stopGeneratingBtn = document.getElementById('stop-generating-btn');
    const sendBtn = document.getElementById('send-btn');

    let currentChatId = null;
    let attachedFiles = [];
    let currentAbortController = null;
    let editState = null;
    
    // --- SVG Icons for easy reuse ---
    const ICONS = {
        user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="1em" height="1em"><path fill="currentColor" d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512H418.3c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304H178.3z"/></svg>`,
        assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em"><path fill="currentColor" d="M256 0c17.7 0 32 14.3 32 32V64H448c17.7 0 32 14.3 32 32s-14.3 32-32 32H352v32c0 17.7-14.3 32-32 32s-32-14.3-32-32V128H224v32c0 17.7-14.3 32-32 32s-32-14.3-32-32V128H64c-17.7 0-32-14.3-32-32s14.3-32 32-32H224V32c0-17.7 14.3-32 32-32zM400 480H112c-26.5 0-48-21.5-48-48V288H448V432c0 26.5-21.5 48-48 48zM256 224a32 32 0 1 1 0 64 32 32 0 1 1 0-64zm-96 32a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm192-32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/></svg>`,
        regenerate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em"><path fill="currentColor" d="M463.5 224H472c13.3 0 24-10.7 24-24V72c0-9.7-5.8-18.5-14.8-22.2s-19.3-1.7-26.2 5.2L413.4 96.6c-87.6-86.5-228.7-86.2-315.8 1c-87.5 87.5-87.5 229.3 0 316.8s229.3 87.5 316.8 0c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0c-62.5 62.5-163.8 62.5-226.3 0s-62.5-163.8 0-226.3c62.2-62.2 162.7-62.5 225.3-1L327 183c-6.9 6.9-8.9 17.2-5.2 26.2s12.5 14.8 22.2 14.8H463.5z"/></svg>`,
        delete: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="1em" height="1em"><path fill="currentColor" d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>`,
        edit: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0L362.3 51.7l97.9 97.9 30.1-30.1c21.9-21.9 21.9-57.3 0-79.2L471.6 21.7zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.8-7.4 21.9-13.5L437.7 172.3 339.7 74.3 172.4 241.7zM96 64C43 64 0 107 0 160V416c0 53 43 96 96 96H352c53 0 96-43 96-96V320c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V160c0-17.7 14.3-32 32-32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32H96z"/></svg>`,
    };

    const init = () => {
        marked.setOptions({
            highlight: function(code, lang) {
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
            const models = await response.json();
            modelSelector.innerHTML = '';
            if (!models || models.length === 0) {
                modelSelector.innerHTML = `<option value="" disabled selected>No text models found</option>`;
                promptInput.placeholder = "No models available. Please start Ollama.";
                document.getElementById('send-btn').disabled = true;
            } else {
                 models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.name;
                    option.textContent = model.name;
                    modelSelector.appendChild(option);
                });
                promptInput.placeholder = "Type your message here...";
                document.getElementById('send-btn').disabled = false;
            }
        } catch (error) {
            console.error('Error loading models:', error);
            modelSelector.innerHTML = `<option value="" disabled selected>Error loading models</option>`;
            promptInput.placeholder = "Could not connect to Ollama.";
            document.getElementById('send-btn').disabled = true;
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
        if (currentAbortController) {
            currentAbortController.abort();
        }
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
        promptInput.addEventListener('input', autoResizeTextarea);
        attachBtn.addEventListener('click', () => fileInput.click());
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
            if (currentAbortController) {
                currentAbortController.abort();
                console.log("Request aborted by user.");
            }
        });
    };

    const createNewChat = () => {
        if (currentAbortController) {
            currentAbortController.abort();
        }
        currentChatId = null;
        editState = null;
        updateActiveChatItem(null);
        renderWelcomeScreen();
        clearFileInputs();
        promptInput.value = '';
        autoResizeTextarea();
        promptInput.focus();
        sendBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="1em" height="1em"><path fill="currentColor" d="M429.6 92.1c4.9-11.9 2.1-25.6-7-34.7s-22.8-11.9-34.7-7l-352 144c-14.2 5.8-22.2 20.8-19.3 35.8s16.1 25.8 31.4 25.8H224V432c0 15.3 10.8 28.4 25.8 31.4s30-5.1 35.8-19.3l144-352z"/></svg>`;
        sendBtn.title = "Send";
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        
        if (editState) {
            await handleEditSubmit();
            return;
        }

        const prompt = promptInput.value.trim();
        const model = modelSelector.value;
        if ((!prompt && attachedFiles.length === 0) || !model) {
            alert("Please select a model and enter a prompt or attach a file.");
            return;
        }
        
        if (currentAbortController) {
            currentAbortController.abort();
        }
        currentAbortController = new AbortController();
        stopGeneratingBtn.classList.remove('hidden');

        let chatIdToUse = currentChatId;
        const formData = new FormData();
        formData.append('prompt', prompt);
        attachedFiles.forEach(file => formData.append('files', file));
        
        if(chatWindow.querySelector('.welcome-screen')) {
             chatWindow.innerHTML = '';
        }
        
        clearFileInputs();
        promptInput.value = '';
        autoResizeTextarea();

        try {
            if (!chatIdToUse) {
                // This is a NEW chat, use the initiate endpoint
                const initResponse = await fetch('/api/chat/initiate', {
                    method: 'POST',
                    body: formData,
                    signal: currentAbortController.signal,
                });
                const initData = await initResponse.json();
                if (!initResponse.ok) throw new Error(initData.error || "Failed to start chat.");
                
                chatIdToUse = initData.chatId;
                currentChatId = initData.chatId;
                await loadChatList();
                updateActiveChatItem(currentChatId);
                renderMessage(initData.user_message, 0);
            } else {
                // This is an EXISTING chat.
                // Step 1: Securely add the user's message to the backend history.
                const addMsgResponse = await fetch(`/api/chat/${chatIdToUse}/add_message`, {
                    method: 'POST',
                    body: formData,
                    signal: currentAbortController.signal,
                });
                const addMsgData = await addMsgResponse.json();
                if (!addMsgResponse.ok) throw new Error(addMsgData.error || "Failed to add message to chat.");

                const userMsgIndex = document.querySelectorAll('.message-container').length;
                renderMessage(addMsgData.user_message, userMsgIndex);
            }

            // Step 2: Now that the message is saved, ask the AI for a response.
            await streamAndRenderResponse(chatIdToUse, model);

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error during chat submission:', error);
                renderMessage({role: 'assistant', content: `**Error:** ${error.message}`}, -1);
            }
        } finally {
            stopGeneratingBtn.classList.add('hidden');
            currentAbortController = null;
        }
    };
    
    async function streamAndRenderResponse(chatId, model) {
        const aiMsgIndex = document.querySelectorAll('.message-container').length;
        const aiMessageContainer = renderMessage({ role: 'assistant', content: '', model: model }, aiMsgIndex, true);
        const contentDiv = aiMessageContainer.querySelector('.message-content');
        
        try {
            const response = await fetch(`/api/chat/${chatId}/respond`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ model }),
                signal: currentAbortController.signal
            });

            if (!response.ok) throw new Error(await response.text());

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = "";
            
            while(true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                fullContent += decoder.decode(value, { stream: true });
                contentDiv.innerHTML = marked.parse(fullContent + '<span class="loading-pulse"></span>');
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
            
            aiMessageContainer.remove();
            const finalMessage = { role: 'assistant', content: fullContent, model: model };
            renderMessage(finalMessage, aiMsgIndex);
            if (document.querySelectorAll('.message-container').length <= 2) {
                 await loadChatList();
            }

        } catch (error) {
            aiMessageContainer.remove();
            if (error.name === 'AbortError') {
                renderMessage({role: 'assistant', content: '*Request cancelled by user.*'}, aiMsgIndex);
            } else {
                console.error("Response streaming error:", error);
                renderMessage({role: 'assistant', content: `**Error:** ${error.message}`}, aiMsgIndex);
            }
        }
    }

    const handleEditSubmit = async () => {
        const newPrompt = promptInput.value.trim();
        const model = modelSelector.value;
        if (!newPrompt || !model || !editState) return;

        if (currentAbortController) {
            currentAbortController.abort();
        }
        currentAbortController = new AbortController();
        stopGeneratingBtn.classList.remove('hidden');

        const userMsgContainer = document.querySelector(`.message-container[data-msg-index="${editState.msgIndex}"]`);
        const userMsgContent = userMsgContainer.querySelector('.message-content');
        userMsgContent.innerHTML = `<p>${newPrompt.replace(/\n/g, '<br>')}</p>`;
        
        const oldAiMsg = document.querySelector(`.message-container[data-msg-index="${editState.msgIndex + 1}"]`);
        if (oldAiMsg) oldAiMsg.remove();
        const aiLoadingMessage = renderMessage({ role: 'assistant', content: '', model: model }, editState.msgIndex + 1, true);

        promptInput.value = '';
        autoResizeTextarea();
        
        try {
            const response = await fetch(`/api/chat/${editState.chatId}/edit_and_regenerate`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ new_prompt: newPrompt, msg_index: editState.msgIndex, model: model }),
                signal: currentAbortController.signal
            });
            const data = await response.json();
            aiLoadingMessage.remove();

            if (!response.ok) throw new Error(data.error || "Failed to edit and regenerate.");
            
            renderMessage(data.response, editState.msgIndex + 1);

        } catch (error) {
             aiLoadingMessage.remove();
             if (error.name === 'AbortError') {
                 renderMessage({role: 'assistant', content: '*Request cancelled by user.*'}, editState.msgIndex + 1);
            } else {
                console.error('Edit submission error:', error);
                renderMessage({role: 'assistant', content: `**Error:** ${error.message}`}, editState.msgIndex + 1);
            }
        } finally {
            editState = null;
            stopGeneratingBtn.classList.add('hidden');
            currentAbortController = null;
            sendBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="1em" height="1em"><path fill="currentColor" d="M429.6 92.1c4.9-11.9 2.1-25.6-7-34.7s-22.8-11.9-34.7-7l-352 144c-14.2 5.8-22.2 20.8-19.3 35.8s16.1 25.8 31.4 25.8H224V432c0 15.3 10.8 28.4 25.8 31.4s30-5.1 35.8-19.3l144-352z"/></svg>`;
            sendBtn.title = "Send";
        }
    };

    const handleEditMessage = (chatId, msgIndex) => {
        const messageContainer = document.querySelector(`.message-container[data-msg-index="${msgIndex}"]`);
        const contentDiv = messageContainer.querySelector('.message-content');
        if (!contentDiv) return;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentDiv.innerHTML.replace(/<br\s*\/?>/ig, '\n');
        const currentText = tempDiv.textContent || tempDiv.innerText || "";

        promptInput.value = currentText.trim();
        promptInput.focus();
        autoResizeTextarea();

        editState = { chatId, msgIndex };
        sendBtn.innerHTML = ICONS.regenerate;
        sendBtn.title = "Edit and Resubmit";
    };
    
    const handleDeleteMessage = async (chatId, msgIndex) => {
        if (!confirm('This will delete the message and its conversational partner. Are you sure?')) return;
        try {
            const response = await fetch(`/api/chat/${chatId}/message/${msgIndex}`, { method: 'DELETE' });
            if (!response.ok) throw new Error((await response.json()).error || 'Failed to delete message.');
            
            const userMsg = document.querySelector(`.message-container[data-msg-index="${msgIndex}"]`);
            const aiMsg = document.querySelector(`.message-container[data-msg-index="${msgIndex+1}"]`);
            if (userMsg) userMsg.remove();
            if (aiMsg) aiMsg.remove();
            
            document.querySelectorAll('.message-container').forEach((el, i) => el.dataset.msgIndex = i);

        } catch (error) {
            console.error(error);
            alert(error.message);
        }
    };

    const handleRegenerateMessage = async (chatId, msgIndex, modelToUse = null) => {
        const messageContainer = document.querySelector(`.message-container[data-msg-index="${msgIndex}"]`);
        if (!messageContainer) return;

        const originalModel = messageContainer.querySelector('.model-tag')?.textContent;
        const model = modelToUse || originalModel || modelSelector.value;
        
        const contentDiv = messageContainer.querySelector('.message-content');
        const actionsDiv = messageContainer.querySelector('.message-actions');
        
        contentDiv.innerHTML = '<p><span class="loading-pulse">Regenerating...</span></p>';
        if (actionsDiv) actionsDiv.style.display = 'none';

        try {
            const response = await fetch(`/api/chat/${chatId}/regenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: model, msg_index: msgIndex })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Failed to regenerate response from server.");
            }

            renderMessage(data.response, msgIndex);

        } catch (error) {
            console.error("Regeneration failed:", error);
            contentDiv.innerHTML = `<p><strong>Error regenerating:</strong> ${error.message}</p>`;
            if (actionsDiv) actionsDiv.style.display = 'flex';
        }
    };
    
    const renderMessage = (msg, index, isLoading = false) => {
        const { role, content, attachments, model } = msg;
        const container = document.createElement('div');
        container.className = `message-container role-${role}`;
        container.dataset.msgIndex = index;

        const profilePic = document.createElement('div');
        profilePic.className = 'profile-pic';
        profilePic.innerHTML = ICONS[role] || '';

        const messageBubble = document.createElement('div');
        messageBubble.className = 'message-bubble';
        
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        const senderName = role === 'user' ? 'You' : 'Assistant';
        messageHeader.innerHTML = `<span class="sender-name">${senderName}</span>`;
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
                    attachmentsHTML += `<div class="attachment-item image-attachment"><img src="${src}" alt="${att.original_filename}" loading="lazy"></div>`;
                } else {
                    attachmentsHTML += `
                        <a href="${src}" target="_blank" class="attachment-item file-attachment">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="1em" height="1em"><path fill="currentColor" d="M0 64C0 28.7 28.7 0 64 0H224V128c0 17.7 14.3 32 32 32H384V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V64zm384 64H256V0L384 128z"/></svg>
                            <span>${att.original_filename}</span>
                        </a>`;
                }
            });
            attachmentsHTML += '</div>';
        }
        
        if (isLoading) {
            messageContent.innerHTML = '<p><span class="loading-pulse"></span></p>';
        } else {
            let processedContent = content || "";
            if (role === 'assistant') {
                processedContent = marked.parse(processedContent);
            } else {
                const escapedContent = processedContent.replace(/</g, "<").replace(/>/g, ">");
                processedContent = `<p>${escapedContent.replace(/\n/g, '<br>')}</p>`;
            }
            messageContent.innerHTML = attachmentsHTML + processedContent;
        }

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
                regenerateGroup.innerHTML = `
                    <button class="action-btn main-action-btn regenerate-btn" title="Regenerate">${ICONS.regenerate}</button>
                    <button class="action-btn options-btn" title="Regenerate with another model">▾</button>
                `;
                regenerateGroup.querySelector('.regenerate-btn').addEventListener('click', () => handleRegenerateMessage(currentChatId, index));
                regenerateGroup.querySelector('.options-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleModelPopup(e.currentTarget, (selectedModel) => {
                        handleRegenerateMessage(currentChatId, index, selectedModel);
                    });
                });
                messageActions.appendChild(regenerateGroup);

            } else {
                const editBtn = document.createElement('button');
                editBtn.className = 'action-btn edit-btn';
                editBtn.title = 'Edit and Regenerate';
                editBtn.innerHTML = ICONS.edit;
                editBtn.addEventListener('click', () => handleEditMessage(currentChatId, index));
                messageActions.appendChild(editBtn);
            }
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'action-btn delete-btn';
            deleteBtn.title = 'Delete';
            deleteBtn.innerHTML = ICONS.delete;
            deleteBtn.addEventListener('click', () => handleDeleteMessage(currentChatId, index));
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
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return container;
    };
    
    const toggleModelPopup = (target, onSelect) => {
        document.querySelectorAll('.model-popup').forEach(p => p.remove());
        const popup = document.createElement('div');
        popup.className = 'model-popup';
        const models = Array.from(modelSelector.options).map(opt => opt.value);
        models.forEach(modelName => {
            const item = document.createElement('div');
            item.className = 'model-popup-item';
            item.textContent = modelName;
            item.addEventListener('click', () => {
                onSelect(modelName);
                popup.remove();
            });
            popup.appendChild(item);
        });
        document.body.appendChild(popup);
        const rect = target.getBoundingClientRect();
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 5}px`;
        setTimeout(() => {
            document.addEventListener('click', function closePopup(e) {
                if (!popup.contains(e.target) && e.target !== target) {
                    popup.remove();
                    document.removeEventListener('click', closePopup);
                }
            }, { once: true });
        }, 0);
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
        promptInput.style.height = `${promptInput.scrollHeight}px`;
    };

    const handleFileSelection = (e) => {
        Array.from(e.target.files).forEach(file => attachedFiles.push(file));
        renderFilePreview();
        fileInput.value = '';
    };
    
    const renderFilePreview = () => {
        filePreviewArea.innerHTML = '';
        if (attachedFiles.length > 0) {
            filePreviewArea.style.paddingBottom = '0.75rem';
        } else {
             filePreviewArea.style.paddingBottom = '0';
        }
        
        attachedFiles.forEach((file, index) => {
            const fileEl = document.createElement('div');
            fileEl.className = 'file-preview';
            const fileNameSpan = document.createElement('span');
            fileNameSpan.textContent = file.name;
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-file-btn';
            removeBtn.title = 'Remove file';
            removeBtn.textContent = '✖';
            
            removeBtn.addEventListener('click', () => {
                attachedFiles.splice(index, 1);
                renderFilePreview();
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