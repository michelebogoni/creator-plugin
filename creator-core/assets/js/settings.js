/**
 * Creator Core - Settings Scripts
 *
 * @package CreatorCore
 */

(function($) {
    'use strict';

    /**
     * Settings Manager
     */
    const CreatorSettings = {
        /**
         * Initialize settings
         */
        init: function() {
            this.bindEvents();
            this.initTabs();
        },

        /**
         * Bind event handlers
         */
        bindEvents: function() {
            // Tab navigation
            $('.creator-tab').on('click', this.handleTabClick.bind(this));

            // License validation
            $('#validate-license').on('click', this.validateLicense.bind(this));

            // Clear cache
            $('#clear-cache').on('click', this.clearCache.bind(this));

            // Cleanup backups
            $('#cleanup-backups').on('click', this.cleanupBackups.bind(this));

            // Test proxy connection
            $('#test-proxy').on('click', this.testProxy.bind(this));

            // Export settings
            $('#export-settings').on('click', this.exportSettings.bind(this));

            // Import settings
            $('#import-settings').on('click', this.importSettings.bind(this));

            // Form validation
            $('input[type="number"]').on('input', this.validateNumberInput);

            // Profile selection
            $('input[name="creator_user_level"]').on('change', this.handleProfileSelection.bind(this));
            $('#save-profile-btn').on('click', this.saveProfile.bind(this));

            // Model selection
            $('input[name="creator_default_model"]').on('change', this.handleModelSelection.bind(this));

            // Context refresh
            $('#refresh-context-btn').on('click', this.refreshContext.bind(this));
        },

        /**
         * Initialize tabs
         */
        initTabs: function() {
            // Get hash from URL or default to first tab (api)
            let activeTab = window.location.hash.replace('#', '') || 'api';

            // Activate the tab
            this.activateTab(activeTab);

            // Handle browser back/forward
            $(window).on('hashchange', function() {
                const hash = window.location.hash.replace('#', '') || 'api';
                CreatorSettings.activateTab(hash);
            });
        },

        /**
         * Handle tab click
         */
        handleTabClick: function(e) {
            e.preventDefault();

            const $tab = $(e.currentTarget);
            const tabId = $tab.attr('href').replace('#', '');

            this.activateTab(tabId);

            // Update URL hash
            window.history.replaceState(null, null, '#' + tabId);
        },

        /**
         * Activate a tab
         */
        activateTab: function(tabId) {
            // Update tab navigation
            $('.creator-tab').removeClass('active');
            $(`.creator-tab[href="#${tabId}"]`).addClass('active');

            // Update tab content
            $('.creator-tab-content').removeClass('active');
            $(`#${tabId}`).addClass('active');
        },

        /**
         * Validate license key
         */
        validateLicense: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const $input = $('input[name="creator_license_key"]');
            const $status = $('#license-validation-status');
            const licenseKey = $input.val().trim();

            if (!licenseKey) {
                $status.html('<span class="creator-status-error">Please enter a license key</span>');
                return;
            }

            // Show loading
            $btn.prop('disabled', true);
            $status.html('<span class="creator-pulse">Validating...</span>');

            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_validate_license',
                    nonce: creatorSettings.nonce,
                    license_key: licenseKey
                },
                success: function(response) {
                    if (response.success) {
                        var licenseData = response.data.data || response.data;
                        var resetDate = licenseData.reset_date || '';
                        var plan = licenseData.plan || 'standard';
                        var statusText = '<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> License valid (' + plan + ')';
                        if (resetDate) {
                            statusText += ' - Resets: ' + resetDate;
                        }
                        statusText += '</span>';
                        $status.html(statusText);
                    } else {
                        $status.html('<span class="creator-status-error"><span class="dashicons dashicons-no"></span> ' + (response.data?.message || 'Invalid license') + '</span>');
                    }
                    $btn.prop('disabled', false);
                },
                error: function() {
                    $status.html('<span class="creator-status-error">Validation failed. Please try again.</span>');
                    $btn.prop('disabled', false);
                }
            });
        },

        /**
         * Clear cache
         */
        clearCache: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const $status = $('#cache-status');

            $btn.prop('disabled', true);
            $status.html('<span class="creator-pulse">Clearing...</span>');

            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_clear_cache',
                    nonce: creatorSettings.nonce
                },
                success: function(response) {
                    if (response.success) {
                        $status.html('<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> Cache cleared</span>');
                        setTimeout(function() {
                            $status.fadeOut();
                        }, 3000);
                    } else {
                        $status.html('<span class="creator-status-error">Failed to clear cache</span>');
                    }
                    $btn.prop('disabled', false);
                },
                error: function() {
                    $status.html('<span class="creator-status-error">Failed to clear cache</span>');
                    $btn.prop('disabled', false);
                }
            });
        },

        /**
         * Cleanup old backups
         */
        cleanupBackups: function(e) {
            e.preventDefault();

            if (!confirm('Are you sure you want to delete old backups? This cannot be undone.')) {
                return;
            }

            const $btn = $(e.currentTarget);
            const $status = $('#backup-status');

            $btn.prop('disabled', true);
            $status.html('<span class="creator-pulse">Cleaning up...</span>');

            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_cleanup_backups',
                    nonce: creatorSettings.nonce
                },
                success: function(response) {
                    if (response.success) {
                        $status.html('<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> ' + response.data.deleted + ' backups deleted</span>');
                    } else {
                        $status.html('<span class="creator-status-error">Cleanup failed</span>');
                    }
                    $btn.prop('disabled', false);
                },
                error: function() {
                    $status.html('<span class="creator-status-error">Cleanup failed</span>');
                    $btn.prop('disabled', false);
                }
            });
        },

        /**
         * Test proxy connection
         */
        testProxy: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const $status = $('#proxy-status');

            $btn.prop('disabled', true);
            $status.html('<span class="creator-pulse">Testing connection...</span>');

            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_test_proxy',
                    nonce: creatorSettings.nonce
                },
                success: function(response) {
                    if (response.success) {
                        $status.html('<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> Connection successful (' + response.data.latency + 'ms)</span>');
                    } else {
                        $status.html('<span class="creator-status-error"><span class="dashicons dashicons-no"></span> ' + (response.data?.message || 'Connection failed') + '</span>');
                    }
                    $btn.prop('disabled', false);
                },
                error: function() {
                    $status.html('<span class="creator-status-error">Connection test failed</span>');
                    $btn.prop('disabled', false);
                }
            });
        },

        /**
         * Export settings
         */
        exportSettings: function(e) {
            e.preventDefault();

            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_export_settings',
                    nonce: creatorSettings.nonce
                },
                success: function(response) {
                    if (response.success) {
                        // Create download
                        const blob = new Blob([JSON.stringify(response.data.settings, null, 2)], {
                            type: 'application/json'
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'creator-settings-' + new Date().toISOString().split('T')[0] + '.json';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    } else {
                        alert('Failed to export settings');
                    }
                }
            });
        },

        /**
         * Import settings
         */
        importSettings: function(e) {
            e.preventDefault();

            // Create file input
            const $input = $('<input type="file" accept=".json" style="display:none">');

            $input.on('change', function(event) {
                const file = event.target.files[0];

                if (!file) {
                    return;
                }

                const reader = new FileReader();

                reader.onload = function(e) {
                    try {
                        const settings = JSON.parse(e.target.result);

                        if (!confirm('This will overwrite your current settings. Continue?')) {
                            return;
                        }

                        $.ajax({
                            url: creatorSettings.ajaxUrl,
                            type: 'POST',
                            data: {
                                action: 'creator_import_settings',
                                nonce: creatorSettings.nonce,
                                settings: JSON.stringify(settings)
                            },
                            success: function(response) {
                                if (response.success) {
                                    alert('Settings imported successfully. Page will reload.');
                                    window.location.reload();
                                } else {
                                    alert('Failed to import settings: ' + (response.data?.message || 'Unknown error'));
                                }
                            }
                        });
                    } catch (error) {
                        alert('Invalid settings file');
                    }
                };

                reader.readAsText(file);
            });

            $('body').append($input);
            $input.trigger('click');
        },

        /**
         * Validate number input
         */
        validateNumberInput: function() {
            const $input = $(this);
            const min = parseInt($input.attr('min')) || 0;
            const max = parseInt($input.attr('max')) || Infinity;
            let value = parseInt($input.val()) || min;

            if (value < min) {
                $input.val(min);
            } else if (value > max) {
                $input.val(max);
            }
        },

        /**
         * Handle profile selection (visual feedback)
         */
        handleProfileSelection: function(e) {
            const $radio = $(e.currentTarget);
            const $card = $radio.closest('.creator-profile-option-card');

            // Remove selected class from all profile cards
            $('.creator-profile-options-horizontal .creator-profile-option-card').removeClass('selected');

            // Add selected class to current card
            $card.addClass('selected');

            // Clear any previous status
            $('#profile-status').text('').removeClass('success error');
        },

        /**
         * Handle model selection (visual feedback)
         */
        handleModelSelection: function(e) {
            const $radio = $(e.currentTarget);
            const $card = $radio.closest('.creator-model-option-card');

            // Remove selected class from all model cards
            $('.creator-model-option-card').removeClass('selected');

            // Add selected class to current card
            $card.addClass('selected');

            // Clear any previous status
            $('#profile-status').text('').removeClass('success error');
        },

        /**
         * Save user profile (including model selection)
         */
        saveProfile: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const $status = $('#profile-status');
            const selectedLevel = $('input[name="creator_user_level"]:checked').val();
            const selectedModel = $('input[name="creator_default_model"]:checked').val();

            if (!selectedLevel) {
                $status.text('Please select a competency level').addClass('error').removeClass('success');
                return;
            }

            // Show loading
            $btn.prop('disabled', true);
            $status.text('Saving...').removeClass('success error');

            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_save_profile',
                    nonce: creatorSettings.nonce,
                    user_level: selectedLevel,
                    default_model: selectedModel
                },
                success: function(response) {
                    if (response.success) {
                        $status.text(response.data.message).addClass('success').removeClass('error');

                        // Update the badge if it exists
                        if (response.data.label) {
                            $('#current-profile-badge').text(response.data.label);
                        }
                    } else {
                        $status.text(response.data?.message || 'Failed to save profile').addClass('error').removeClass('success');
                    }
                    $btn.prop('disabled', false);
                },
                error: function() {
                    $status.text('Failed to save profile. Please try again.').addClass('error').removeClass('success');
                    $btn.prop('disabled', false);
                }
            });
        },

        /**
         * Refresh Creator Context
         */
        refreshContext: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const $status = $('#context-status');
            const $icon = $btn.find('.dashicons');

            // Show loading
            $btn.prop('disabled', true);
            $icon.addClass('creator-spin');
            $status.html('<span class="creator-pulse">Generating context...</span>');

            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_refresh_context',
                    nonce: creatorSettings.nonce
                },
                success: function(response) {
                    if (response.success) {
                        const stats = response.data.stats;
                        $status.html(
                            '<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> ' +
                            response.data.message + ' (' + response.data.duration_ms + 'ms)' +
                            '</span>'
                        );

                        // Update stats in the UI
                        $('.creator-context-stats tr:nth-child(2) td strong').text(stats.plugins);
                        $('.creator-context-stats tr:nth-child(3) td strong').text(stats.cpts);
                        $('.creator-context-stats tr:nth-child(4) td strong').text(stats.acf);
                        $('.creator-context-stats tr:nth-child(5) td strong').text(stats.sitemap);

                        // Update generated at timestamp
                        if (response.data.timestamp) {
                            const date = new Date(response.data.timestamp);
                            $('.creator-context-stats tr:nth-child(1) td').text(date.toLocaleString());
                        }

                        // Update header to show "Up to Date"
                        $('.creator-context-header .creator-status-badge')
                            .removeClass('warning')
                            .addClass('success')
                            .text('Up to Date');

                        // Change button text if it was "Generate Context"
                        $btn.find('span:not(.dashicons)').text('Refresh Context');
                    } else {
                        $status.html(
                            '<span class="creator-status-error"><span class="dashicons dashicons-no"></span> ' +
                            (response.data?.message || 'Failed to refresh context') +
                            '</span>'
                        );
                    }
                    $btn.prop('disabled', false);
                    $icon.removeClass('creator-spin');
                },
                error: function() {
                    $status.html('<span class="creator-status-error"><span class="dashicons dashicons-no"></span> Failed to refresh context. Please try again.</span>');
                    $btn.prop('disabled', false);
                    $icon.removeClass('creator-spin');
                }
            });
        }
    };

    /**
     * Integration Settings Manager
     */
    const IntegrationSettings = {
        /**
         * Initialize
         */
        init: function() {
            this.bindEvents();
            this.checkIntegrations();
        },

        /**
         * Bind events
         */
        bindEvents: function() {
            // Toggle integration
            $('.creator-toggle-integration').on('change', this.toggleIntegration.bind(this));

            // Configure integration
            $('.creator-configure-integration').on('click', this.openConfiguration.bind(this));
        },

        /**
         * Check integration status
         */
        checkIntegrations: function() {
            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_check_integrations',
                    nonce: creatorSettings.nonce
                },
                success: function(response) {
                    if (response.success) {
                        IntegrationSettings.updateStatus(response.data);
                    }
                }
            });
        },

        /**
         * Update integration status
         */
        updateStatus: function(integrations) {
            Object.keys(integrations).forEach(function(key) {
                const integration = integrations[key];
                const $row = $(`.creator-integration-row[data-integration="${key}"]`);

                if ($row.length) {
                    const $status = $row.find('.creator-integration-status');

                    if (integration.available) {
                        $status.html('<span class="creator-status-badge success"><span class="dashicons dashicons-yes"></span> Available</span>');
                        $row.find('.creator-toggle-integration').prop('disabled', false);
                    } else {
                        $status.html('<span class="creator-status-badge"><span class="dashicons dashicons-no"></span> Not installed</span>');
                        $row.find('.creator-toggle-integration').prop('disabled', true);
                    }

                    if (integration.version) {
                        $row.find('.creator-integration-version').text('v' + integration.version);
                    }
                }
            });
        },

        /**
         * Toggle integration
         */
        toggleIntegration: function(e) {
            const $toggle = $(e.currentTarget);
            const integration = $toggle.closest('.creator-integration-row').data('integration');
            const enabled = $toggle.is(':checked');

            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_toggle_integration',
                    nonce: creatorSettings.nonce,
                    integration: integration,
                    enabled: enabled ? 1 : 0
                },
                success: function(response) {
                    if (!response.success) {
                        $toggle.prop('checked', !enabled);
                        alert('Failed to toggle integration');
                    }
                },
                error: function() {
                    $toggle.prop('checked', !enabled);
                    alert('Failed to toggle integration');
                }
            });
        },

        /**
         * Open integration configuration
         */
        openConfiguration: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const integration = $btn.closest('.creator-integration-row').data('integration');

            // Load configuration modal
            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_get_integration_config',
                    nonce: creatorSettings.nonce,
                    integration: integration
                },
                success: function(response) {
                    if (response.success) {
                        IntegrationSettings.showConfigModal(integration, response.data);
                    }
                }
            });
        },

        /**
         * Show configuration modal
         */
        showConfigModal: function(integration, config) {
            // Remove existing modal
            $('#creator-config-modal').remove();

            let fieldsHtml = '';

            Object.keys(config.fields || {}).forEach(function(key) {
                const field = config.fields[key];
                fieldsHtml += `
                    <div class="creator-form-row">
                        <label for="config-${key}">${field.label}</label>
                        <input type="${field.type || 'text'}"
                               id="config-${key}"
                               name="${key}"
                               value="${field.value || ''}"
                               ${field.required ? 'required' : ''}>
                        ${field.description ? `<p class="description">${field.description}</p>` : ''}
                    </div>
                `;
            });

            const modal = $(`
                <div id="creator-config-modal" class="creator-modal">
                    <div class="creator-modal-overlay"></div>
                    <div class="creator-modal-content">
                        <div class="creator-modal-header">
                            <h3>Configure ${config.name || integration}</h3>
                            <button class="creator-modal-close">&times;</button>
                        </div>
                        <div class="creator-modal-body">
                            <form id="integration-config-form">
                                ${fieldsHtml}
                            </form>
                        </div>
                        <div class="creator-modal-footer">
                            <button class="creator-btn creator-btn-secondary creator-modal-cancel">Cancel</button>
                            <button class="creator-btn creator-btn-primary creator-save-config">Save</button>
                        </div>
                    </div>
                </div>
            `);

            $('body').append(modal);

            // Bind modal events
            modal.find('.creator-modal-overlay, .creator-modal-close, .creator-modal-cancel').on('click', function() {
                modal.remove();
            });

            modal.find('.creator-save-config').on('click', function() {
                IntegrationSettings.saveConfiguration(integration, modal);
            });
        },

        /**
         * Save integration configuration
         */
        saveConfiguration: function(integration, $modal) {
            const $form = $modal.find('#integration-config-form');
            const formData = {};

            $form.find('input, select, textarea').each(function() {
                formData[$(this).attr('name')] = $(this).val();
            });

            $.ajax({
                url: creatorSettings.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_save_integration_config',
                    nonce: creatorSettings.nonce,
                    integration: integration,
                    config: JSON.stringify(formData)
                },
                success: function(response) {
                    if (response.success) {
                        $modal.remove();
                    } else {
                        alert('Failed to save configuration');
                    }
                },
                error: function() {
                    alert('Failed to save configuration');
                }
            });
        }
    };

    // Initialize on document ready
    $(document).ready(function() {
        if ($('.creator-settings').length && typeof creatorSettings !== 'undefined') {
            CreatorSettings.init();
            IntegrationSettings.init();
        }
    });

})(jQuery);
