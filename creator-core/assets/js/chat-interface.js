/**
 * Creator Core - Chat Interface Scripts
 *
 * @package CreatorCore
 */

(function($) {
    'use strict';

    /**
     * Chat Interface Manager
     */
    const CreatorChat = {
        chatId: null,
        isTyping: false,
        messageQueue: [],
        attachedFiles: [], // Store attached files as base64

        /**
         * Initialize chat interface
         */
        init: function() {
            this.chatId = creatorChat.chatId || null;
            this.attachedFiles = [];
            this.bindEvents();
            this.initTextarea();
            this.scrollToBottom();
        },

        /**
         * Bind event handlers
         */
        bindEvents: function() {
            // Send message form
            $('#creator-chat-form').on('submit', this.handleSubmit.bind(this));

            // Message input
            $('#creator-message-input').on('input', this.handleInput.bind(this));
            $('#creator-message-input').on('keydown', this.handleKeydown.bind(this));

            // Suggestion buttons
            $('.creator-suggestion').on('click', this.handleSuggestion.bind(this));

            // Edit title button
            $('.creator-edit-title').on('click', this.handleEditTitle.bind(this));

            // Action buttons in messages
            $(document).on('click', '.creator-action-btn', this.handleActionButton.bind(this));

            // Retry failed action
            $(document).on('click', '.creator-retry-action', this.handleRetryAction.bind(this));

            // Rollback action
            $(document).on('click', '.creator-rollback-action', this.handleRollback.bind(this));

            // Capability tabs
            $(document).on('click', '.creator-tab', this.handleTabClick.bind(this));

            // Model toggle in chat header
            $('input[name="chat_model"]').on('change', this.handleModelToggle.bind(this));

            // File attachment
            $('#creator-attach-btn').on('click', this.handleAttachClick.bind(this));
            $('#creator-file-input').on('change', this.handleFileSelect.bind(this));
            $(document).on('click', '.creator-attachment-remove', this.handleAttachmentRemove.bind(this));
        },

        /**
         * Handle model toggle selection
         */
        handleModelToggle: function(e) {
            const $radio = $(e.currentTarget);
            const $option = $radio.closest('.creator-model-toggle-option');

            // Remove active class from all options
            $('.creator-model-toggle-option').removeClass('active');

            // Add active class to selected option
            $option.addClass('active');

            // Update data attribute on container
            $('.creator-chat-container').data('model', $radio.val());
        },

        /**
         * Get selected model
         */
        getSelectedModel: function() {
            const selected = $('input[name="chat_model"]:checked').val();
            return selected || $('.creator-chat-container').data('model') || 'gemini';
        },

        /**
         * Handle capability tab click
         */
        handleTabClick: function(e) {
            const $tab = $(e.currentTarget);
            const tabName = $tab.data('tab');

            // Update active tab
            $('.creator-tab').removeClass('active');
            $tab.addClass('active');

            // Show/hide corresponding suggestions
            $('[data-tab-content]').hide();
            $('[data-tab-content="' + tabName + '"]').show();
        },

        /**
         * Initialize auto-growing textarea
         */
        initTextarea: function() {
            const $textarea = $('#creator-message-input');

            $textarea.on('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            });
        },

        /**
         * Handle form submission
         */
        handleSubmit: function(e) {
            e.preventDefault();

            const $input = $('#creator-message-input');
            const message = $input.val().trim();

            // Allow sending with only files (no message) or with message
            if ((!message && this.attachedFiles.length === 0) || this.isTyping) {
                return;
            }

            // Send message with files
            this.sendMessage(message, this.attachedFiles.slice());

            // Clear input and attachments
            $input.val('').trigger('input');
            this.clearAttachments();
        },

        /**
         * Handle input changes
         */
        handleInput: function(e) {
            const $btn = $('.creator-send-btn');
            const hasValue = $(e.target).val().trim().length > 0;
            const hasFiles = this.attachedFiles && this.attachedFiles.length > 0;

            // Enable send if there's text OR files
            $btn.prop('disabled', (!hasValue && !hasFiles) || this.isTyping);
        },

        /**
         * Handle keyboard shortcuts
         */
        handleKeydown: function(e) {
            // Submit on Enter (without Shift)
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                $('#creator-chat-form').trigger('submit');
            }
        },

        /**
         * Handle suggestion click
         */
        handleSuggestion: function(e) {
            const suggestion = $(e.currentTarget).text();
            $('#creator-message-input').val(suggestion).trigger('input');
            $('#creator-chat-form').trigger('submit');
        },

        /**
         * Send message to API
         */
        sendMessage: function(message, files = []) {
            const self = this;

            // Build message with attachment info for display
            const messageData = {
                role: 'user',
                content: message || '',
                sender_name: creatorChat.userName,
                timestamp: new Date().toISOString()
            };

            // Add attachment info for display
            if (files && files.length > 0) {
                messageData.attachments = files.map(f => ({
                    name: f.name,
                    type: f.type,
                    size: f.size
                }));
            }

            // Add user message to UI immediately
            this.addMessage(messageData);

            // Hide welcome message if present
            $('.creator-welcome-message').fadeOut();

            // Show typing indicator
            this.showTypingIndicator();

            // Store files for sending
            this.pendingFiles = files;

            // If no chat exists, create one first
            if (!this.chatId) {
                this.createChatAndSendMessage(message);
                return;
            }

            // Send to existing chat
            this.sendMessageToChat(this.chatId, message);
        },

        /**
         * Create a new chat and send the first message
         */
        createChatAndSendMessage: function(message) {
            const self = this;
            const selectedModel = this.getSelectedModel();

            $.ajax({
                url: creatorChat.restUrl + 'chats',
                type: 'POST',
                contentType: 'application/json',
                timeout: 30000, // 30 second timeout for chat creation
                headers: {
                    'X-WP-Nonce': creatorChat.restNonce
                },
                data: JSON.stringify({
                    title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
                    ai_model: selectedModel
                }),
                success: function(response) {
                    if (response.success && response.chat && response.chat.id) {
                        self.chatId = response.chat.id;
                        self.updateUrl(response.chat.id);

                        // Hide model toggle after chat is created (model is now locked)
                        $('.creator-model-toggle').fadeOut(function() {
                            // Show model badge instead
                            const modelBadge = '<div class="creator-model-badge">' +
                                '<span class="creator-model-badge-icon">' + (selectedModel === 'gemini' ? '🔷' : '🟠') + '</span>' +
                                '<span class="creator-model-badge-label">' + (selectedModel === 'gemini' ? 'Gemini 3 Pro' : 'Claude Sonnet 4') + '</span>' +
                            '</div>';
                            $(this).replaceWith(modelBadge);
                        });

                        self.sendMessageToChat(response.chat.id, message);
                    } else {
                        self.hideTypingIndicator();
                        const errorMsg = response.message || response.error || 'Failed to create chat';
                        self.showError(errorMsg, self.isLicenseError(errorMsg));
                    }
                },
                error: function(xhr, status, error) {
                    self.hideTypingIndicator();
                    let errorMsg;
                    if (status === 'timeout') {
                        errorMsg = 'Request timed out. Please try again.';
                    } else {
                        errorMsg = xhr.responseJSON?.message || xhr.responseJSON?.error || 'Failed to create chat';
                    }
                    console.error('[CreatorChat] Create chat error:', { status, error, xhr: xhr.status });
                    self.showError(errorMsg, self.isLicenseError(errorMsg));
                }
            });
        },

        /**
         * Send message to an existing chat
         */
        sendMessageToChat: function(chatId, message) {
            const self = this;

            // Build request data
            const requestData = {
                content: message || ''
            };

            // Include files if present
            if (this.pendingFiles && this.pendingFiles.length > 0) {
                requestData.files = this.pendingFiles;
                this.pendingFiles = []; // Clear after including
            }

            $.ajax({
                url: creatorChat.restUrl + 'chats/' + chatId + '/messages',
                type: 'POST',
                contentType: 'application/json',
                headers: {
                    'X-WP-Nonce': creatorChat.restNonce
                },
                data: JSON.stringify(requestData),
                success: function(response) {
                    self.hideTypingIndicator();

                    if (response.success) {
                        // Update chat ID if new chat
                        if (response.chat_id) {
                            self.chatId = response.chat_id;
                            self.updateUrl(response.chat_id);
                        }

                        // Add AI response
                        self.addMessage({
                            role: 'assistant',
                            content: response.response,
                            timestamp: new Date().toISOString(),
                            actions: response.actions || []
                        });

                        // Process any actions
                        if (response.actions && response.actions.length > 0) {
                            self.processActions(response.actions);
                        }
                    } else {
                        const errorMsg = response.message || 'Failed to send message';
                        self.showError(errorMsg, self.isLicenseError(errorMsg));
                    }
                },
                error: function(xhr) {
                    self.hideTypingIndicator();
                    const error = xhr.responseJSON?.message || 'Failed to send message';
                    self.showError(error, self.isLicenseError(error));
                }
            });
        },

        /**
         * Add message to chat UI
         */
        addMessage: function(message) {
            const $messages = $('.creator-chat-messages');
            const html = this.renderMessage(message);

            $messages.append(html);
            this.scrollToBottom();
        },

        /**
         * Render message HTML
         */
        renderMessage: function(message) {
            const isUser = message.role === 'user';
            const senderName = isUser ? creatorChat.userName : 'Creator AI';
            const timeStr = this.formatTime(message.timestamp);

            let html = `
                <div class="creator-message creator-message-${message.role}">
                    <div class="creator-message-avatar">
            `;

            if (isUser) {
                html += `<img src="${creatorChat.userAvatar}" alt="${senderName}">`;
            } else {
                html += `
                    <div class="creator-ai-avatar">
                        <span class="dashicons dashicons-admin-generic"></span>
                    </div>
                `;
            }

            html += `
                    </div>
                    <div class="creator-message-content">
                        <div class="creator-message-header">
                            <span class="creator-message-sender">${this.escapeHtml(senderName)}</span>
                            <span class="creator-message-time">${timeStr}</span>
                        </div>
                        <div class="creator-message-body">
                            ${this.formatMessageContent(message.content, message.isError)}
                        </div>
            `;

            // Add action cards if present
            if (message.actions && message.actions.length > 0) {
                html += '<div class="creator-message-actions">';
                message.actions.forEach(function(action) {
                    html += CreatorChat.renderActionCard(action);
                });
                html += '</div>';
            }

            html += `
                    </div>
                </div>
            `;

            return html;
        },

        /**
         * Render action card HTML
         */
        renderActionCard: function(action) {
            const statusClass = 'creator-status-' + (action.status || 'pending');
            const statusText = this.getStatusText(action.status);
            const iconClass = this.getActionIcon(action.type);

            // Encode action data for storage in data attribute
            const actionDataEncoded = this.escapeHtml(JSON.stringify(action));

            let html = `
                <div class="creator-action-card" data-action-id="${action.id || ''}" data-action='${actionDataEncoded}'>
                    <div class="creator-action-header">
                        <div class="creator-action-icon">
                            <span class="dashicons ${iconClass}"></span>
                        </div>
                        <span class="creator-action-title">${this.escapeHtml(action.title || this.getActionTitle(action.type, action.params))}</span>
                        <span class="creator-action-status ${statusClass}">
                            ${statusText}
                        </span>
                    </div>
            `;

            if (action.target) {
                html += `<div class="creator-action-target">${this.escapeHtml(action.target)}</div>`;
            }

            if (action.status === 'failed' && action.error) {
                html += `
                    <div class="creator-action-error">
                        <span class="dashicons dashicons-warning"></span>
                        ${this.escapeHtml(action.error)}
                    </div>
                `;
            }

            // Add action buttons
            html += '<div class="creator-action-buttons">';

            if (action.status === 'pending') {
                html += `
                    <button class="creator-btn creator-btn-primary creator-btn-sm creator-action-btn"
                            data-action="execute">
                        <span class="dashicons dashicons-yes"></span> Execute
                    </button>
                    <button class="creator-btn creator-btn-secondary creator-btn-sm creator-action-btn"
                            data-action="skip">
                        Skip
                    </button>
                `;
            } else if (action.status === 'failed') {
                html += `
                    <button class="creator-btn creator-btn-secondary creator-btn-sm creator-retry-action">
                        <span class="dashicons dashicons-update"></span> Retry
                    </button>
                `;
            } else if (action.status === 'completed' && action.can_rollback) {
                html += `
                    <button class="creator-btn creator-btn-outline creator-btn-sm creator-rollback-action">
                        <span class="dashicons dashicons-undo"></span> Rollback
                    </button>
                `;
            }

            html += '</div></div>';

            return html;
        },

        /**
         * Get status text
         */
        getStatusText: function(status) {
            const statusMap = {
                'pending': '<span class="dashicons dashicons-clock"></span> Pending',
                'executing': '<span class="dashicons dashicons-update creator-spin"></span> Executing',
                'completed': '<span class="dashicons dashicons-yes-alt"></span> Completed',
                'failed': '<span class="dashicons dashicons-dismiss"></span> Failed'
            };
            return statusMap[status] || status;
        },

        /**
         * Get action icon
         */
        getActionIcon: function(type) {
            const iconMap = {
                'create_post': 'dashicons-edit',
                'create_page': 'dashicons-admin-page',
                'update_post': 'dashicons-update',
                'delete_post': 'dashicons-trash',
                'update_option': 'dashicons-admin-settings',
                'upload_media': 'dashicons-admin-media',
                'install_plugin': 'dashicons-plugins-checked',
                'update_elementor': 'dashicons-welcome-widgets-menus',
                'update_acf': 'dashicons-database',
                'update_rankmath': 'dashicons-chart-line',
                'update_woocommerce': 'dashicons-cart'
            };
            return iconMap[type] || 'dashicons-admin-generic';
        },

        /**
         * Process actions from response
         */
        processActions: function(actions) {
            const self = this;

            // Check for actions that should be auto-executed
            actions.forEach(function(action, index) {
                if (action.status === 'ready') {
                    // Auto-execute actions marked as ready
                    console.log('Auto-executing action:', action);

                    // Find the action card and execute it
                    setTimeout(function() {
                        const $card = $('.creator-action-card').eq(index);
                        if ($card.length) {
                            self.executeActionDirectly(action, $card);
                        }
                    }, 500); // Small delay for UI to render
                } else {
                    console.log('Action pending user confirmation:', action);
                }
            });
        },

        /**
         * Execute action directly (for auto-execution)
         */
        executeActionDirectly: function(action, $card) {
            const self = this;

            // Update status
            $card.find('.creator-action-status')
                .removeClass('creator-status-pending')
                .addClass('creator-status-executing')
                .html('<span class="dashicons dashicons-update creator-spin"></span> Executing');

            // Disable buttons
            $card.find('.creator-action-buttons button').prop('disabled', true);

            $.ajax({
                url: creatorChat.restUrl + 'actions/execute',
                type: 'POST',
                contentType: 'application/json',
                headers: {
                    'X-WP-Nonce': creatorChat.restNonce
                },
                data: JSON.stringify({
                    action: action,
                    chat_id: self.chatId
                }),
                success: function(response) {
                    if (response.success) {
                        $card.find('.creator-action-status')
                            .removeClass('creator-status-executing')
                            .addClass('creator-status-completed')
                            .html('<span class="dashicons dashicons-yes-alt"></span> Completed');

                        // Show result info if available (data contains URLs etc.)
                        if (response.data) {
                            self.showActionResult(response.data, $card);
                        }

                        // Show rollback button if snapshot was created
                        if (response.snapshot_id) {
                            $card.find('.creator-action-buttons').html(`
                                <button class="creator-btn creator-btn-outline creator-btn-sm creator-rollback-action"
                                        data-snapshot-id="${response.snapshot_id}">
                                    <span class="dashicons dashicons-undo"></span> Rollback
                                </button>
                            `);
                        } else {
                            $card.find('.creator-action-buttons').empty();
                        }
                    } else {
                        self.handleActionError($card, response.message || response.error);
                    }
                },
                error: function(xhr) {
                    const error = xhr.responseJSON?.message || xhr.responseJSON?.error || 'Action failed';
                    self.handleActionError($card, error);
                }
            });
        },

        /**
         * Show action result (e.g., links to created content)
         */
        showActionResult: function(data, $card) {
            let resultHtml = '<div class="creator-action-result">';

            if (data.edit_url) {
                resultHtml += `<a href="${data.edit_url}" target="_blank" class="creator-btn creator-btn-sm creator-btn-link">
                    <span class="dashicons dashicons-edit"></span> Edit
                </a>`;
            }

            if (data.view_url) {
                resultHtml += `<a href="${data.view_url}" target="_blank" class="creator-btn creator-btn-sm creator-btn-link">
                    <span class="dashicons dashicons-visibility"></span> View
                </a>`;
            }

            if (data.elementor_url) {
                resultHtml += `<a href="${data.elementor_url}" target="_blank" class="creator-btn creator-btn-sm creator-btn-primary">
                    <span class="dashicons dashicons-welcome-widgets-menus"></span> Edit with Elementor
                </a>`;
            }

            resultHtml += '</div>';

            $card.find('.creator-action-buttons').before(resultHtml);
        },

        /**
         * Handle action button click
         */
        handleActionButton: function(e) {
            const $btn = $(e.currentTarget);
            const $card = $btn.closest('.creator-action-card');
            const actionId = $card.data('action-id');
            const action = $btn.data('action');

            if (action === 'execute') {
                this.executeAction(actionId, $card);
            } else if (action === 'skip') {
                $card.fadeOut();
            }
        },

        /**
         * Execute an action
         */
        executeAction: function(actionId, $card) {
            const self = this;

            // Get action data from card
            let actionData = null;
            try {
                const actionStr = $card.attr('data-action');
                if (actionStr) {
                    actionData = JSON.parse(actionStr);
                }
            } catch (e) {
                console.error('Failed to parse action data:', e);
            }

            if (!actionData) {
                self.handleActionError($card, 'No action data available');
                return;
            }

            // Update status
            $card.find('.creator-action-status')
                .removeClass('creator-status-pending')
                .addClass('creator-status-executing')
                .html('<span class="dashicons dashicons-update creator-spin"></span> Executing');

            // Disable buttons
            $card.find('.creator-action-buttons button').prop('disabled', true);

            $.ajax({
                url: creatorChat.restUrl + 'actions/execute',
                type: 'POST',
                contentType: 'application/json',
                headers: {
                    'X-WP-Nonce': creatorChat.restNonce
                },
                data: JSON.stringify({
                    action: actionData,
                    chat_id: self.chatId
                }),
                success: function(response) {
                    if (response.success) {
                        $card.find('.creator-action-status')
                            .removeClass('creator-status-executing')
                            .addClass('creator-status-completed')
                            .html('<span class="dashicons dashicons-yes-alt"></span> Completed');

                        // Show result info if available (data contains URLs etc.)
                        if (response.data) {
                            self.showActionResult(response.data, $card);
                        }

                        // Show rollback button if snapshot was created
                        if (response.snapshot_id) {
                            $card.find('.creator-action-buttons').html(`
                                <button class="creator-btn creator-btn-outline creator-btn-sm creator-rollback-action"
                                        data-snapshot-id="${response.snapshot_id}">
                                    <span class="dashicons dashicons-undo"></span> Rollback
                                </button>
                            `);
                        } else {
                            $card.find('.creator-action-buttons').empty();
                        }
                    } else {
                        self.handleActionError($card, response.message || response.error);
                    }
                },
                error: function(xhr) {
                    const error = xhr.responseJSON?.message || xhr.responseJSON?.error || 'Action failed';
                    self.handleActionError($card, error);
                }
            });
        },

        /**
         * Get human-readable action title
         */
        getActionTitle: function(type, params) {
            const titles = {
                'create_page': 'Create Page' + (params?.title ? ': ' + params.title : ''),
                'create_post': 'Create Post' + (params?.title ? ': ' + params.title : ''),
                'update_page': 'Update Page' + (params?.title ? ': ' + params.title : ''),
                'update_post': 'Update Post' + (params?.title ? ': ' + params.title : ''),
                'delete_page': 'Delete Page',
                'delete_post': 'Delete Post',
                'create_plugin': 'Create Plugin' + (params?.name ? ': ' + params.name : ''),
                'update_elementor': 'Update Elementor',
                'update_acf': 'Update ACF Fields',
                'read_file': 'Read File' + (params?.path ? ': ' + params.path : ''),
                'write_file': 'Write File' + (params?.path ? ': ' + params.path : ''),
                'db_query': 'Database Query'
            };

            return titles[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        },

        /**
         * Handle action error
         */
        handleActionError: function($card, error) {
            $card.find('.creator-action-status')
                .removeClass('creator-status-executing')
                .addClass('creator-status-failed')
                .html('<span class="dashicons dashicons-dismiss"></span> Failed');

            // Add error message
            if (!$card.find('.creator-action-error').length) {
                $card.find('.creator-action-header').after(`
                    <div class="creator-action-error">
                        <span class="dashicons dashicons-warning"></span>
                        ${this.escapeHtml(error)}
                    </div>
                `);
            }

            // Show retry button
            $card.find('.creator-action-buttons').html(`
                <button class="creator-btn creator-btn-secondary creator-btn-sm creator-retry-action">
                    <span class="dashicons dashicons-update"></span> Retry
                </button>
            `);
        },

        /**
         * Handle retry action
         */
        handleRetryAction: function(e) {
            const $card = $(e.currentTarget).closest('.creator-action-card');
            const actionId = $card.data('action-id');

            $card.find('.creator-action-error').remove();
            this.executeAction(actionId, $card);
        },

        /**
         * Handle rollback
         */
        handleRollback: function(e) {
            const $btn = $(e.currentTarget);
            const $card = $btn.closest('.creator-action-card');
            const actionId = $card.data('action-id');

            if (!confirm('Are you sure you want to rollback this action?')) {
                return;
            }

            $btn.prop('disabled', true).text('Rolling back...');

            $.ajax({
                url: creatorChat.restUrl + 'actions/' + actionId + '/rollback',
                type: 'POST',
                headers: {
                    'X-WP-Nonce': creatorChat.restNonce
                },
                success: function(response) {
                    if (response.success) {
                        $card.find('.creator-action-status')
                            .removeClass('creator-status-completed')
                            .addClass('creator-status-pending')
                            .html('<span class="dashicons dashicons-undo"></span> Rolled back');

                        $card.find('.creator-action-buttons').empty();
                    } else {
                        alert('Rollback failed: ' + response.message);
                        $btn.prop('disabled', false).html(
                            '<span class="dashicons dashicons-undo"></span> Rollback'
                        );
                    }
                },
                error: function(xhr) {
                    alert('Rollback failed: ' + (xhr.responseJSON?.message || 'Unknown error'));
                    $btn.prop('disabled', false).html(
                        '<span class="dashicons dashicons-undo"></span> Rollback'
                    );
                }
            });
        },

        /**
         * Handle edit title click
         */
        handleEditTitle: function() {
            const $title = $('.creator-chat-title');
            const currentTitle = $title.find('span').first().text();

            const newTitle = prompt('Enter new chat title:', currentTitle);

            if (newTitle && newTitle !== currentTitle) {
                $.ajax({
                    url: creatorChat.restUrl + 'chats/' + this.chatId,
                    type: 'PUT',
                    contentType: 'application/json',
                    headers: {
                        'X-WP-Nonce': creatorChat.restNonce
                    },
                    data: JSON.stringify({ title: newTitle }),
                    success: function(response) {
                        if (response.success) {
                            $title.find('span').first().text(newTitle);
                        }
                    }
                });
            }
        },

        /**
         * Show typing indicator
         */
        showTypingIndicator: function() {
            this.isTyping = true;

            const $indicator = $(`
                <div class="creator-typing-indicator" id="typing-indicator">
                    <div class="dot"></div>
                    <div class="dot"></div>
                    <div class="dot"></div>
                    <span>Creator AI is thinking...</span>
                </div>
            `);

            $('.creator-input-info').prepend($indicator);
            $('.creator-send-btn').prop('disabled', true);
        },

        /**
         * Hide typing indicator
         */
        hideTypingIndicator: function() {
            this.isTyping = false;
            $('#typing-indicator').remove();

            const hasValue = $('#creator-message-input').val().trim().length > 0;
            $('.creator-send-btn').prop('disabled', !hasValue);
        },

        /**
         * Check if error is license-related
         */
        isLicenseError: function(message) {
            if (!message) return false;
            const lowerMsg = message.toLowerCase();
            return lowerMsg.includes('license') ||
                   lowerMsg.includes('authenticated') ||
                   lowerMsg.includes('authentication') ||
                   lowerMsg.includes('site token') ||
                   lowerMsg.includes('not authorized');
        },

        /**
         * Show error message
         */
        showError: function(message, showSettingsLink) {
            const settingsUrl = creatorChat.settingsUrl || (creatorChat.adminUrl + '?page=creator-settings');
            let errorContent = '**' + message + '**';

            if (showSettingsLink) {
                errorContent += '\n\n[' + creatorChat.i18n.goToSettings + '](' + settingsUrl + ')';
            }

            this.addMessage({
                role: 'assistant',
                content: errorContent,
                isError: true,
                timestamp: new Date().toISOString()
            });
        },

        /**
         * Update URL with chat ID
         */
        updateUrl: function(chatId) {
            const url = new URL(window.location);
            url.searchParams.set('chat', chatId);
            window.history.replaceState({}, '', url);
        },

        /**
         * Scroll to bottom of messages
         */
        scrollToBottom: function() {
            const $messages = $('.creator-chat-messages');
            $messages.scrollTop($messages[0].scrollHeight);
        },

        /**
         * Format message content
         */
        formatMessageContent: function(content, isError) {
            if (!content) return '';

            // Basic markdown-like formatting
            let formatted = this.escapeHtml(content);

            // Convert **bold** to <strong>
            formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            // Convert *italic* to <em>
            formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');

            // Convert `code` to <code>
            formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');

            // Convert [text](url) to <a href="url">text</a>
            formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="creator-link">$1</a>');

            // Convert newlines to <br>
            formatted = formatted.replace(/\n/g, '<br>');

            // Wrap error messages in error styling
            if (isError) {
                formatted = '<span class="creator-error-text">' + formatted + '</span>';
            }

            return formatted;
        },

        /**
         * Format timestamp
         */
        formatTime: function(timestamp) {
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;

            if (diff < 60000) {
                return 'Just now';
            } else if (diff < 3600000) {
                const mins = Math.floor(diff / 60000);
                return mins + ' min ago';
            } else if (diff < 86400000) {
                const hours = Math.floor(diff / 3600000);
                return hours + ' hour' + (hours > 1 ? 's' : '') + ' ago';
            } else {
                return date.toLocaleDateString();
            }
        },

        /**
         * Escape HTML entities
         */
        escapeHtml: function(text) {
            if (typeof text !== 'string') return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        // ==========================================
        // File Attachment Methods
        // ==========================================

        /**
         * Handle attachment button click
         */
        handleAttachClick: function(e) {
            e.preventDefault();
            $('#creator-file-input').click();
        },

        /**
         * Handle file selection
         */
        handleFileSelect: function(e) {
            const files = e.target.files;
            const self = this;
            const maxFiles = creatorChat.maxFilesPerMessage || 3;
            const maxSize = creatorChat.maxFileSize || 10 * 1024 * 1024;

            if (!files || files.length === 0) return;

            // Check total files limit
            if (this.attachedFiles.length + files.length > maxFiles) {
                alert(creatorChat.i18n?.maxFilesError || 'Maximum ' + maxFiles + ' files allowed.');
                e.target.value = '';
                return;
            }

            // Process each file
            Array.from(files).forEach(function(file) {
                // Check file size
                if (file.size > maxSize) {
                    alert((creatorChat.i18n?.fileTooLarge || 'File too large:') + ' ' + file.name);
                    return;
                }

                // Read file as base64
                const reader = new FileReader();
                reader.onload = function(event) {
                    self.attachedFiles.push({
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        base64: event.target.result
                    });
                    self.updateAttachmentPreview();
                    self.updateSendButton();
                };
                reader.readAsDataURL(file);
            });

            // Clear the input for next selection
            e.target.value = '';
        },

        /**
         * Handle attachment remove
         */
        handleAttachmentRemove: function(e) {
            e.preventDefault();
            const index = $(e.currentTarget).data('index');
            this.attachedFiles.splice(index, 1);
            this.updateAttachmentPreview();
            this.updateSendButton();
        },

        /**
         * Update attachment preview area
         */
        updateAttachmentPreview: function() {
            const $preview = $('#creator-attachment-preview');
            const $list = $preview.find('.creator-attachment-list');
            const $info = $('.creator-attachment-info');

            if (this.attachedFiles.length === 0) {
                $preview.hide();
                $info.hide();
                $list.empty();
                return;
            }

            $preview.show();
            $info.show();

            let html = '';
            this.attachedFiles.forEach(function(file, index) {
                const icon = this.getFileIcon(file.type);
                const size = this.formatFileSize(file.size);

                html += '<div class="creator-attachment-item" data-index="' + index + '">';
                html += '<span class="creator-attachment-icon">' + icon + '</span>';
                html += '<span class="creator-attachment-name">' + this.escapeHtml(file.name) + '</span>';
                html += '<span class="creator-attachment-size">' + size + '</span>';
                html += '<button type="button" class="creator-attachment-remove" data-index="' + index + '">';
                html += '<span class="dashicons dashicons-no-alt"></span>';
                html += '</button>';
                html += '</div>';
            }.bind(this));

            $list.html(html);
        },

        /**
         * Update send button state
         */
        updateSendButton: function() {
            const $btn = $('.creator-send-btn');
            const hasValue = $('#creator-message-input').val().trim().length > 0;
            const hasFiles = this.attachedFiles.length > 0;

            $btn.prop('disabled', (!hasValue && !hasFiles) || this.isTyping);
        },

        /**
         * Clear all attachments
         */
        clearAttachments: function() {
            this.attachedFiles = [];
            this.pendingFiles = [];
            $('#creator-file-input').val('');
            this.updateAttachmentPreview();
        },

        /**
         * Get file icon based on type
         */
        getFileIcon: function(mimeType) {
            if (mimeType.startsWith('image/')) {
                return '<span class="dashicons dashicons-format-image"></span>';
            } else if (mimeType === 'application/pdf') {
                return '<span class="dashicons dashicons-media-document"></span>';
            } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
                return '<span class="dashicons dashicons-media-spreadsheet"></span>';
            } else if (mimeType.includes('word') || mimeType.includes('document')) {
                return '<span class="dashicons dashicons-media-document"></span>';
            } else if (mimeType.includes('javascript') || mimeType.includes('json') ||
                       mimeType.includes('php') || mimeType.includes('html') ||
                       mimeType.includes('css') || mimeType.includes('sql')) {
                return '<span class="dashicons dashicons-editor-code"></span>';
            } else if (mimeType === 'text/plain') {
                return '<span class="dashicons dashicons-text"></span>';
            }
            return '<span class="dashicons dashicons-media-default"></span>';
        },

        /**
         * Format file size for display
         */
        formatFileSize: function(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }
    };

    // ==========================================
    // THINKING PANEL - Creator's Reasoning Process
    // ==========================================

    /**
     * ThinkingPanel - Shows Creator's thinking process to users
     * Supports real-time streaming via Server-Sent Events (SSE)
     */
    window.CreatorThinking = {
        panel: null,
        logContainer: null,
        isVisible: false,
        logs: [],
        eventSource: null,
        chatId: null,
        lastReceivedIndex: -1,
        connectionLost: false,
        recoveryAttempts: 0,
        maxRecoveryAttempts: 3,

        /**
         * Initialize the thinking panel
         */
        init: function() {
            this.createPanel();
            this.bindEvents();
        },

        /**
         * Start streaming thinking logs via SSE
         * @param {number} chatId - The chat ID to stream logs for
         */
        startStreaming: function(chatId) {
            const self = this;
            this.chatId = chatId;
            this.lastReceivedIndex = -1;
            this.connectionLost = false;
            this.recoveryAttempts = 0;

            // Close any existing connection
            this.stopStreaming();

            // Show panel and clear previous logs
            this.show();

            // Initialize EventSource for SSE
            const url = creatorChat.restUrl + 'thinking/stream/' + chatId;

            try {
                this.eventSource = new EventSource(url, {
                    withCredentials: true
                });

                // Handle connection established
                this.eventSource.addEventListener('connected', function(event) {
                    const data = JSON.parse(event.data);
                    console.log('[CreatorThinking] SSE connected for chat:', data.chat_id);
                    self.connectionLost = false;
                    self.recoveryAttempts = 0;
                });

                // Handle incoming thinking logs
                this.eventSource.addEventListener('thinking', function(event) {
                    try {
                        const log = JSON.parse(event.data);
                        // Track last received index for recovery
                        if (log.id) {
                            self.lastReceivedIndex = log.id;
                        } else {
                            self.lastReceivedIndex = self.logs.length;
                        }
                        self.addLog(log);
                    } catch (e) {
                        console.error('[CreatorThinking] Error parsing log:', e);
                    }
                });

                // Handle completion
                this.eventSource.addEventListener('complete', function(event) {
                    try {
                        const data = JSON.parse(event.data);
                        console.log('[CreatorThinking] Stream complete:', data);
                        self.onStreamComplete(data);
                    } catch (e) {
                        console.error('[CreatorThinking] Error parsing complete event:', e);
                    }
                    self.stopStreaming();
                });

                // Handle timeout
                this.eventSource.addEventListener('timeout', function(event) {
                    console.warn('[CreatorThinking] Stream timed out');
                    self.addLog({
                        phase: 'system',
                        level: 'warning',
                        message: 'Stream timed out - processing may still continue',
                        elapsed_ms: 0
                    });
                    self.stopStreaming();
                    // Try to recover any missed logs
                    self.handleConnectionLoss();
                });

                // Handle connection errors
                this.eventSource.onerror = function(error) {
                    console.error('[CreatorThinking] SSE error:', error);
                    self.connectionLost = true;
                    self.stopStreaming();
                    // Try to recover any missed logs
                    self.handleConnectionLoss();
                };

            } catch (e) {
                console.error('[CreatorThinking] Failed to create EventSource:', e);
                // Fallback to non-streaming mode
                this.showLoading();
            }
        },

        /**
         * Stop streaming and close EventSource connection
         */
        stopStreaming: function() {
            if (this.eventSource) {
                this.eventSource.close();
                this.eventSource = null;
            }
        },

        /**
         * Handle connection loss - recover missed logs from REST API
         * Uses exponential backoff (1s, 2s, 4s) and request timeout
         */
        handleConnectionLoss: function() {
            const self = this;

            // Don't retry too many times
            if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
                console.warn('[CreatorThinking] Max recovery attempts reached');
                this.showRecoveryError();
                return;
            }

            this.recoveryAttempts++;
            const backoffDelay = Math.pow(2, this.recoveryAttempts - 1) * 1000; // 1s, 2s, 4s

            console.log('[CreatorThinking] Attempting to recover logs (attempt ' + this.recoveryAttempts + ') after ' + backoffDelay + 'ms');

            // Use exponential backoff delay
            setTimeout(function() {
                // Fetch logs from REST API with timeout
                $.ajax({
                    url: creatorChat.restUrl + 'thinking/' + self.chatId,
                    type: 'GET',
                    timeout: 5000, // 5 second timeout
                    headers: {
                        'X-WP-Nonce': creatorChat.restNonce
                    },
                    success: function(response) {
                        // Reset recovery attempts on success
                        self.recoveryAttempts = 0;

                        if (response.success && response.thinking && response.thinking.length > 0) {
                            // Add logs that we didn't receive via SSE
                            const existingCount = self.logs.length;
                            response.thinking.forEach(function(log, index) {
                                if (index >= existingCount) {
                                    self.addLog(log);
                                }
                            });
                            console.log('[CreatorThinking] Recovered ' + (response.thinking.length - existingCount) + ' missed logs');
                        }
                    },
                    error: function(xhr, status) {
                        console.error('[CreatorThinking] Failed to recover logs (status: ' + status + '):', xhr.responseText);

                        // Retry with backoff if attempts remaining
                        if (self.recoveryAttempts < self.maxRecoveryAttempts) {
                            self.handleConnectionLoss();
                        } else {
                            self.showRecoveryError();
                        }
                    }
                });
            }, backoffDelay);
        },

        /**
         * Show recovery error message to user
         */
        showRecoveryError: function() {
            if (this.logContainer && this.logContainer.length) {
                const errorHtml = `
                    <div class="creator-thinking-log-item level-warning">
                        <span class="creator-thinking-log-message">Connection lost. Refresh page to retry.</span>
                    </div>
                `;
                this.logContainer.append(errorHtml);
            }
        },

        /**
         * Handle stream completion
         * @param {object} data - Completion data from server
         */
        onStreamComplete: function(data) {
            this.hide();
            if (data.total_logs === 0) {
                this.remove();
            }
        },

        /**
         * Create the thinking panel HTML
         */
        createPanel: function() {
            // Check if container exists
            const $container = $('.creator-input-container');
            if ($container.length === 0) {
                console.warn('[CreatorThinking] Input container not found, panel will not be created');
                return;
            }

            const panelHtml = `
                <div class="creator-thinking-panel collapsed" id="creator-thinking-panel" style="display: none;">
                    <div class="creator-thinking-header">
                        <span class="creator-thinking-icon">💭</span>
                        <span class="creator-thinking-title">Creator's Thinking</span>
                        <span class="creator-thinking-badge" id="thinking-badge">0</span>
                        <button class="creator-thinking-toggle" id="thinking-toggle">+</button>
                    </div>
                    <div class="creator-thinking-content">
                        <div class="creator-thinking-log" id="thinking-log"></div>
                    </div>
                    <div class="creator-thinking-summary" id="thinking-summary" style="display: none;">
                        <div class="creator-thinking-summary-stats">
                            <span class="creator-thinking-summary-stat" id="thinking-elapsed">
                                <span class="dashicons dashicons-clock"></span>
                                <span>0ms</span>
                            </span>
                            <span class="creator-thinking-summary-stat" id="thinking-steps">
                                <span class="dashicons dashicons-list-view"></span>
                                <span>0 steps</span>
                            </span>
                        </div>
                    </div>
                </div>
            `;

            // Insert panel before the input area
            $container.before(panelHtml);
            this.panel = $('#creator-thinking-panel');
            this.logContainer = $('#thinking-log');
        },

        /**
         * Bind event handlers
         */
        bindEvents: function() {
            const self = this;

            // Toggle collapse/expand
            $(document).on('click', '#thinking-toggle, .creator-thinking-header', function(e) {
                if ($(e.target).is('#thinking-toggle') || $(e.target).closest('.creator-thinking-header').length) {
                    self.togglePanel();
                }
            });
        },

        /**
         * Toggle panel collapse state
         */
        togglePanel: function() {
            if (!this.panel || this.panel.length === 0) {
                return;
            }
            this.panel.toggleClass('collapsed');
            const isCollapsed = this.panel.hasClass('collapsed');
            $('#thinking-toggle').text(isCollapsed ? '+' : '−');
        },

        /**
         * Show the thinking panel
         */
        show: function() {
            // Ensure panel is created
            if (!this.panel || this.panel.length === 0) {
                this.createPanel();
            }
            // If still no panel, bail out
            if (!this.panel || this.panel.length === 0) {
                console.warn('[CreatorThinking] Cannot show - panel not available');
                return;
            }

            this.isVisible = true;
            this.logs = [];
            if (this.logContainer && this.logContainer.length) {
                this.logContainer.empty();
            }
            this.panel.show().removeClass('collapsed');
            $('#thinking-toggle').text('−');
            $('#thinking-badge').text('0');
            $('#thinking-summary').hide();
        },

        /**
         * Hide the thinking panel (collapse but keep visible)
         */
        hide: function() {
            this.isVisible = false;
            if (this.panel && this.panel.length) {
                this.panel.addClass('collapsed');
            }
            $('#thinking-toggle').text('+');
            this.showSummary();
        },

        /**
         * Add a log entry
         */
        addLog: function(log) {
            this.logs.push(log);

            // Skip DOM operations if container not available
            if (!this.logContainer || this.logContainer.length === 0) {
                return;
            }

            const logItem = $(`
                <div class="creator-thinking-log-item level-${log.level || 'info'}">
                    <span class="creator-thinking-log-phase ${log.phase || ''}">${log.phase || ''}</span>
                    <span class="creator-thinking-log-message">${this.escapeHtml(log.message)}</span>
                    <span class="creator-thinking-log-time">${log.elapsed_ms || 0}ms</span>
                </div>
            `);

            this.logContainer.append(logItem);
            if (this.logContainer[0]) {
                this.logContainer.scrollTop(this.logContainer[0].scrollHeight);
            }

            // Update badge
            $('#thinking-badge').text(this.logs.length);
        },

        /**
         * Add multiple logs at once
         */
        addLogs: function(logs) {
            if (!Array.isArray(logs)) return;

            logs.forEach(log => this.addLog(log));
        },

        /**
         * Show summary after completion
         */
        showSummary: function() {
            if (this.logs.length === 0) return;

            const lastLog = this.logs[this.logs.length - 1];
            const elapsed = lastLog ? lastLog.elapsed_ms : 0;

            $('#thinking-elapsed span:last-child').text(elapsed + 'ms');
            $('#thinking-steps span:last-child').text(this.logs.length + ' steps');
            $('#thinking-summary').show();
        },

        /**
         * Clear the thinking panel
         */
        clear: function() {
            this.logs = [];
            if (this.logContainer && this.logContainer.length) {
                this.logContainer.empty();
            }
            $('#thinking-badge').text('0');
            $('#thinking-summary').hide();
        },

        /**
         * Completely hide the panel
         */
        remove: function() {
            if (this.panel && this.panel.length) {
                this.panel.hide();
            }
            this.clear();
        },

        /**
         * Show loading state
         */
        showLoading: function() {
            this.show();
            this.addLog({
                phase: 'discovery',
                level: 'info',
                message: 'Analyzing your request...',
                elapsed_ms: 0
            });
        },

        /**
         * Escape HTML entities
         */
        escapeHtml: function(text) {
            if (typeof text !== 'string') return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    // Extend CreatorChat to use ThinkingPanel
    const originalShowTypingIndicator = CreatorChat.showTypingIndicator;
    CreatorChat.showTypingIndicator = function() {
        originalShowTypingIndicator.call(this);
        CreatorThinking.showLoading();
    };

    const originalHideTypingIndicator = CreatorChat.hideTypingIndicator;
    CreatorChat.hideTypingIndicator = function() {
        originalHideTypingIndicator.call(this);
        // Don't hide thinking panel immediately - let it stay visible
    };

    // Handle thinking data from response with SSE streaming support
    const originalSendMessageToChat = CreatorChat.sendMessageToChat;
    CreatorChat.sendMessageToChat = function(chatId, message) {
        const self = this;

        // Start SSE streaming for real-time thinking updates
        // This will display thinking logs as they're generated
        if (chatId) {
            CreatorThinking.startStreaming(chatId);
        } else {
            // For new chats, just show loading until we get the chat ID
            CreatorThinking.showLoading();
        }

        // Build request data
        const requestData = {
            content: message || ''
        };

        // Include files if present
        if (this.pendingFiles && this.pendingFiles.length > 0) {
            requestData.files = this.pendingFiles;
            this.pendingFiles = [];
        }

        $.ajax({
            url: creatorChat.restUrl + 'chats/' + chatId + '/messages',
            type: 'POST',
            contentType: 'application/json',
            timeout: 90000, // 90 second timeout (slightly less than server's 120s)
            headers: {
                'X-WP-Nonce': creatorChat.restNonce
            },
            data: JSON.stringify(requestData),
            success: function(response) {
                self.hideTypingIndicator();

                if (response.success) {
                    // Update chat ID if new chat
                    if (response.chat_id) {
                        self.chatId = response.chat_id;
                        self.updateUrl(response.chat_id);

                        // If this was a new chat, start streaming now that we have the ID
                        if (!chatId && response.chat_id) {
                            CreatorThinking.startStreaming(response.chat_id);
                        }
                    }

                    // Stop streaming since response is complete
                    CreatorThinking.stopStreaming();

                    // Handle thinking logs if present (fallback if SSE didn't get them)
                    if (response.thinking && response.thinking.length > 0) {
                        // Only add logs if we didn't receive them via SSE
                        if (CreatorThinking.logs.length === 0) {
                            CreatorThinking.addLogs(response.thinking);
                        }
                        CreatorThinking.hide();
                    } else if (CreatorThinking.logs.length > 0) {
                        // We got logs via SSE, just hide the panel
                        CreatorThinking.hide();
                    } else {
                        // No logs at all, remove panel
                        CreatorThinking.remove();
                    }

                    // Add AI response
                    self.addMessage({
                        role: 'assistant',
                        content: response.response,
                        timestamp: new Date().toISOString(),
                        actions: response.actions || []
                    });

                    // Process any actions
                    if (response.actions && response.actions.length > 0) {
                        self.processActions(response.actions);
                    }
                } else {
                    CreatorThinking.stopStreaming();
                    CreatorThinking.remove();
                    const errorMsg = response.message || response.error || 'Failed to send message';
                    self.showError(errorMsg, self.isLicenseError(errorMsg));
                }
            },
            error: function(xhr, status, error) {
                self.hideTypingIndicator();
                CreatorThinking.stopStreaming();
                CreatorThinking.remove();

                // Handle different error types
                let errorMsg;
                if (status === 'timeout') {
                    errorMsg = 'Request timed out. The AI service may be overloaded. Please try again.';
                } else if (status === 'abort') {
                    errorMsg = 'Request was cancelled.';
                } else if (xhr.status === 0) {
                    errorMsg = 'Network error. Please check your connection and try again.';
                } else {
                    errorMsg = xhr.responseJSON?.message || xhr.responseJSON?.error || error || 'Failed to send message';
                }

                console.error('[CreatorChat] AJAX error:', { status, error, xhr: xhr.status, response: xhr.responseText });
                self.showError(errorMsg, self.isLicenseError(errorMsg));
            }
        });
    };

    // Initialize on document ready
    $(document).ready(function() {
        if ($('.creator-chat-container').length) {
            CreatorChat.init();
            CreatorThinking.init();
        }
    });

})(jQuery);
