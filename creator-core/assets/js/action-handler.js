/**
 * Creator Core - Action Handler Scripts
 *
 * Handles execution, confirmation, and rollback of WordPress actions
 *
 * @package CreatorCore
 */

(function($) {
    'use strict';

    /**
     * Action Handler
     */
    window.CreatorActionHandler = {
        /**
         * Action queue
         */
        queue: [],

        /**
         * Currently executing action
         */
        currentAction: null,

        /**
         * Initialize action handler
         */
        init: function() {
            this.bindEvents();
        },

        /**
         * Bind event handlers
         */
        bindEvents: function() {
            // Execute single action
            $(document).on('click', '.creator-execute-action', this.onExecuteClick.bind(this));

            // Execute all actions
            $(document).on('click', '.creator-execute-all', this.onExecuteAllClick.bind(this));

            // Cancel action
            $(document).on('click', '.creator-cancel-action', this.onCancelClick.bind(this));

            // Rollback action
            $(document).on('click', '.creator-rollback-action', this.onRollbackClick.bind(this));

            // View action details
            $(document).on('click', '.creator-view-details', this.onViewDetailsClick.bind(this));
        },

        /**
         * Handle execute button click
         */
        onExecuteClick: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const actionId = $btn.data('action-id');

            if (!actionId) {
                console.error('No action ID provided');
                return;
            }

            this.executeAction(actionId);
        },

        /**
         * Handle execute all click
         */
        onExecuteAllClick: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const actionIds = $btn.data('action-ids');

            if (!actionIds || !actionIds.length) {
                console.error('No action IDs provided');
                return;
            }

            // Confirm execution
            if (!confirm('Execute ' + actionIds.length + ' actions?')) {
                return;
            }

            // Add all to queue
            this.queue = actionIds.slice();
            this.processQueue();
        },

        /**
         * Handle cancel click
         */
        onCancelClick: function(e) {
            e.preventDefault();

            const $card = $(e.currentTarget).closest('.creator-action-card');

            // Slide up and remove
            $card.slideUp(300, function() {
                $(this).remove();
            });
        },

        /**
         * Handle rollback click
         */
        onRollbackClick: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const actionId = $btn.data('action-id');

            if (!actionId) {
                console.error('No action ID provided');
                return;
            }

            // Confirm rollback
            if (!confirm('Are you sure you want to rollback this action? This will restore the previous state.')) {
                return;
            }

            this.rollbackAction(actionId, $btn);
        },

        /**
         * Handle view details click
         */
        onViewDetailsClick: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const actionId = $btn.data('action-id');

            this.showActionDetails(actionId);
        },

        /**
         * Execute a single action
         */
        executeAction: function(actionId) {
            const self = this;
            const $card = $('[data-action-id="' + actionId + '"]');

            // Update UI state
            this.setActionState($card, 'executing');
            this.currentAction = actionId;

            // Make API call
            $.ajax({
                url: creatorAction.restUrl + 'actions/execute',
                type: 'POST',
                headers: {
                    'X-WP-Nonce': creatorAction.restNonce
                },
                success: function(response) {
                    self.currentAction = null;

                    if (response.success) {
                        self.setActionState($card, 'completed', response);
                        self.triggerEvent('action:completed', {
                            actionId: actionId,
                            result: response
                        });
                    } else {
                        self.setActionState($card, 'failed', { error: response.message });
                        self.triggerEvent('action:failed', {
                            actionId: actionId,
                            error: response.message
                        });
                    }

                    // Process next in queue
                    self.processQueue();
                },
                error: function(xhr) {
                    self.currentAction = null;
                    const error = xhr.responseJSON?.message || 'Action execution failed';

                    self.setActionState($card, 'failed', { error: error });
                    self.triggerEvent('action:failed', {
                        actionId: actionId,
                        error: error
                    });

                    // Process next in queue
                    self.processQueue();
                }
            });
        },

        /**
         * Rollback an action
         */
        rollbackAction: function(actionId, $btn) {
            const self = this;
            const $card = $btn.closest('.creator-action-card');

            // Disable button
            $btn.prop('disabled', true).addClass('loading');

            $.ajax({
                url: creatorAction.restUrl + 'actions/' + actionId + '/rollback',
                type: 'POST',
                headers: {
                    'X-WP-Nonce': creatorAction.restNonce
                },
                success: function(response) {
                    if (response.success) {
                        self.setActionState($card, 'rolled_back');
                        self.triggerEvent('action:rolledback', {
                            actionId: actionId
                        });
                    } else {
                        alert('Rollback failed: ' + response.message);
                        $btn.prop('disabled', false).removeClass('loading');
                    }
                },
                error: function(xhr) {
                    const error = xhr.responseJSON?.message || 'Rollback failed';
                    alert('Rollback failed: ' + error);
                    $btn.prop('disabled', false).removeClass('loading');
                }
            });
        },

        /**
         * Process action queue
         */
        processQueue: function() {
            if (this.queue.length === 0 || this.currentAction) {
                return;
            }

            const nextActionId = this.queue.shift();
            this.executeAction(nextActionId);
        },

        /**
         * Set action card state
         */
        setActionState: function($card, state, data) {
            // Remove previous state classes
            $card.removeClass('state-pending state-executing state-completed state-failed state-rolled_back');

            // Add new state class
            $card.addClass('state-' + state);

            // Update status indicator
            const $status = $card.find('.creator-action-status');

            switch (state) {
                case 'executing':
                    $status
                        .removeClass('creator-status-pending creator-status-completed creator-status-failed')
                        .addClass('creator-status-executing')
                        .html('<span class="dashicons dashicons-update creator-spin"></span> Executing');
                    $card.find('.creator-action-buttons button').prop('disabled', true);
                    break;

                case 'completed':
                    $status
                        .removeClass('creator-status-pending creator-status-executing creator-status-failed')
                        .addClass('creator-status-completed')
                        .html('<span class="dashicons dashicons-yes-alt"></span> Completed');
                    this.updateActionButtons($card, 'completed', data);
                    break;

                case 'failed':
                    $status
                        .removeClass('creator-status-pending creator-status-executing creator-status-completed')
                        .addClass('creator-status-failed')
                        .html('<span class="dashicons dashicons-dismiss"></span> Failed');
                    this.showActionError($card, data.error);
                    this.updateActionButtons($card, 'failed');
                    break;

                case 'rolled_back':
                    $status
                        .removeClass('creator-status-completed')
                        .addClass('creator-status-pending')
                        .html('<span class="dashicons dashicons-undo"></span> Rolled back');
                    $card.find('.creator-action-buttons').empty();
                    break;
            }
        },

        /**
         * Update action buttons based on state
         */
        updateActionButtons: function($card, state, data) {
            const $buttons = $card.find('.creator-action-buttons');
            const actionId = $card.data('action-id');

            $buttons.empty();

            switch (state) {
                case 'completed':
                    if (data && data.can_rollback) {
                        $buttons.html(`
                            <button class="creator-btn creator-btn-outline creator-btn-sm creator-rollback-action"
                                    data-action-id="${actionId}">
                                <span class="dashicons dashicons-undo"></span> Rollback
                            </button>
                            <button class="creator-btn creator-btn-link creator-btn-sm creator-view-details"
                                    data-action-id="${actionId}">
                                View Details
                            </button>
                        `);
                    }
                    break;

                case 'failed':
                    $buttons.html(`
                        <button class="creator-btn creator-btn-secondary creator-btn-sm creator-execute-action"
                                data-action-id="${actionId}">
                            <span class="dashicons dashicons-update"></span> Retry
                        </button>
                        <button class="creator-btn creator-btn-link creator-btn-sm creator-cancel-action">
                            Dismiss
                        </button>
                    `);
                    break;
            }
        },

        /**
         * Show action error
         */
        showActionError: function($card, error) {
            // Remove any existing error
            $card.find('.creator-action-error').remove();

            // Add error message
            const $error = $(`
                <div class="creator-action-error">
                    <span class="dashicons dashicons-warning"></span>
                    <span>${this.escapeHtml(error)}</span>
                </div>
            `);

            $card.find('.creator-action-header').after($error);
        },

        /**
         * Show action details modal
         */
        showActionDetails: function(actionId) {
            const self = this;

            $.ajax({
                url: creatorAction.restUrl + 'actions/' + actionId,
                type: 'GET',
                headers: {
                    'X-WP-Nonce': creatorAction.restNonce
                },
                success: function(response) {
                    if (response.success) {
                        self.renderDetailsModal(response.data);
                    }
                }
            });
        },

        /**
         * Render details modal
         */
        renderDetailsModal: function(action) {
            // Remove existing modal
            $('#creator-action-modal').remove();

            const modal = $(`
                <div id="creator-action-modal" class="creator-modal">
                    <div class="creator-modal-overlay"></div>
                    <div class="creator-modal-content">
                        <div class="creator-modal-header">
                            <h3>Action Details</h3>
                            <button class="creator-modal-close">&times;</button>
                        </div>
                        <div class="creator-modal-body">
                            <table class="creator-details-table">
                                <tr>
                                    <th>Type:</th>
                                    <td>${this.escapeHtml(action.type)}</td>
                                </tr>
                                <tr>
                                    <th>Status:</th>
                                    <td>${this.escapeHtml(action.status)}</td>
                                </tr>
                                <tr>
                                    <th>Target:</th>
                                    <td>${this.escapeHtml(action.target_type)} #${action.target_id}</td>
                                </tr>
                                <tr>
                                    <th>Created:</th>
                                    <td>${new Date(action.created_at).toLocaleString()}</td>
                                </tr>
                                ${action.executed_at ? `
                                <tr>
                                    <th>Executed:</th>
                                    <td>${new Date(action.executed_at).toLocaleString()}</td>
                                </tr>
                                ` : ''}
                            </table>

                            ${action.before_state ? `
                            <h4>Before State</h4>
                            <pre class="creator-json-preview">${JSON.stringify(JSON.parse(action.before_state), null, 2)}</pre>
                            ` : ''}

                            ${action.after_state ? `
                            <h4>After State</h4>
                            <pre class="creator-json-preview">${JSON.stringify(JSON.parse(action.after_state), null, 2)}</pre>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `);

            $('body').append(modal);

            // Bind close handlers
            modal.find('.creator-modal-overlay, .creator-modal-close').on('click', function() {
                modal.remove();
            });
        },

        /**
         * Trigger custom event
         */
        triggerEvent: function(eventName, data) {
            $(document).trigger(eventName, [data]);
        },

        /**
         * Escape HTML
         */
        escapeHtml: function(text) {
            if (typeof text !== 'string') return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    // Initialize on document ready
    $(document).ready(function() {
        if (typeof creatorAction !== 'undefined') {
            CreatorActionHandler.init();
        }
    });

})(jQuery);
