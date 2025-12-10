/**
 * Creator Core - Admin Dashboard Scripts
 *
 * @package CreatorCore
 */

(function($) {
    'use strict';

    /**
     * Dashboard Manager
     */
    const CreatorDashboard = {
        /**
         * Initialize dashboard
         */
        init: function() {
            this.bindEvents();
            this.loadStats();
        },

        /**
         * Bind event handlers
         */
        bindEvents: function() {
            // Quick action buttons
            $('.creator-quick-action').on('click', this.handleQuickAction.bind(this));

            // Refresh stats button
            $('#creator-refresh-stats').on('click', this.loadStats.bind(this));

            // Chat item hover effects
            $('.creator-chat-item a').on('mouseenter', this.highlightChat);
            $('.creator-chat-item a').on('mouseleave', this.unhighlightChat);
        },

        /**
         * Handle quick action clicks
         */
        handleQuickAction: function(e) {
            const $btn = $(e.currentTarget);
            const action = $btn.data('action');

            if (action === 'new-chat') {
                // Navigate to new chat
                window.location.href = creatorDashboard.newChatUrl;
            }
        },

        /**
         * Load dashboard statistics
         */
        loadStats: function() {
            const $statsGrid = $('.creator-stats-grid');

            if ($statsGrid.length === 0) {
                return;
            }

            // Show loading state
            $statsGrid.addClass('creator-pulse');

            $.ajax({
                url: creatorDashboard.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_get_stats',
                    nonce: creatorDashboard.nonce
                },
                success: function(response) {
                    if (response.success && response.data) {
                        CreatorDashboard.updateStats(response.data);
                    }
                },
                error: function() {
                    console.error('Failed to load dashboard stats');
                },
                complete: function() {
                    $statsGrid.removeClass('creator-pulse');
                }
            });
        },

        /**
         * Update stats display
         */
        updateStats: function(stats) {
            if (stats.total_chats !== undefined) {
                $('#stat-total-chats').text(stats.total_chats);
            }
            if (stats.total_messages !== undefined) {
                $('#stat-total-messages').text(stats.total_messages);
            }
            if (stats.actions_executed !== undefined) {
                $('#stat-actions-executed').text(stats.actions_executed);
            }
            if (stats.success_rate !== undefined) {
                $('#stat-success-rate').text(stats.success_rate + '%');
            }
        },

        /**
         * Highlight chat item on hover
         */
        highlightChat: function() {
            $(this).addClass('hover');
        },

        /**
         * Remove chat highlight
         */
        unhighlightChat: function() {
            $(this).removeClass('hover');
        }
    };

    /**
     * Recent Activity Manager
     */
    const ActivityManager = {
        /**
         * Initialize activity manager
         */
        init: function() {
            this.autoRefresh();
        },

        /**
         * Auto refresh activity feed
         */
        autoRefresh: function() {
            // Refresh every 30 seconds
            setInterval(this.loadActivity.bind(this), 30000);
        },

        /**
         * Load recent activity
         */
        loadActivity: function() {
            const $activityList = $('.creator-activity-list');

            if ($activityList.length === 0 || !document.hasFocus()) {
                return;
            }

            $.ajax({
                url: creatorDashboard.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_get_recent_activity',
                    nonce: creatorDashboard.nonce
                },
                success: function(response) {
                    if (response.success && response.data) {
                        ActivityManager.updateActivityList(response.data);
                    }
                }
            });
        },

        /**
         * Update activity list
         */
        updateActivityList: function(activities) {
            const $list = $('.creator-activity-list');

            if (activities.length === 0) {
                return;
            }

            let html = '';
            activities.forEach(function(activity) {
                html += ActivityManager.renderActivityItem(activity);
            });

            $list.html(html);
        },

        /**
         * Render single activity item
         */
        renderActivityItem: function(activity) {
            const iconClass = activity.success ? 'dashicons-yes' : 'dashicons-no';
            const statusClass = activity.success ? 'success' : 'failure';

            return `
                <li class="creator-activity-item ${statusClass}">
                    <span class="creator-activity-icon">
                        <span class="dashicons ${iconClass}"></span>
                    </span>
                    <span class="creator-activity-action">${this.escapeHtml(activity.action)}</span>
                    <span class="creator-activity-time">${activity.time_ago}</span>
                </li>
            `;
        },

        /**
         * Escape HTML entities
         */
        escapeHtml: function(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    /**
     * Integration Status Manager
     */
    const IntegrationManager = {
        /**
         * Initialize
         */
        init: function() {
            this.checkIntegrations();
        },

        /**
         * Check integration status
         */
        checkIntegrations: function() {
            const $list = $('.creator-integration-list');

            if ($list.length === 0) {
                return;
            }

            $.ajax({
                url: creatorDashboard.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_check_integrations',
                    nonce: creatorDashboard.nonce
                },
                success: function(response) {
                    if (response.success && response.data) {
                        IntegrationManager.updateIntegrations(response.data);
                    }
                }
            });
        },

        /**
         * Update integrations display
         */
        updateIntegrations: function(integrations) {
            Object.keys(integrations).forEach(function(key) {
                const integration = integrations[key];
                const $item = $(`.creator-integration-item[data-integration="${key}"]`);

                if ($item.length) {
                    $item.toggleClass('active', integration.active);
                    $item.toggleClass('inactive', !integration.active);

                    const $icon = $item.find('.creator-integration-status .dashicons');
                    $icon.removeClass('dashicons-yes dashicons-no');
                    $icon.addClass(integration.active ? 'dashicons-yes' : 'dashicons-no');

                    if (integration.version) {
                        $item.find('.creator-integration-version').text('v' + integration.version);
                    }
                }
            });
        }
    };

    // Initialize on document ready
    $(document).ready(function() {
        // Only run on dashboard page
        if ($('.creator-dashboard').length) {
            CreatorDashboard.init();
            ActivityManager.init();
            IntegrationManager.init();
        }
    });

})(jQuery);
