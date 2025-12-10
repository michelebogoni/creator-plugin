/**
 * Creator Core - Setup Wizard Scripts
 *
 * @package CreatorCore
 */

(function($) {
    'use strict';

    /**
     * Setup Wizard Manager
     */
    const SetupWizard = {
        /**
         * Initialize wizard
         */
        init: function() {
            this.bindEvents();
            this.initializeStepSpecificBehavior();
        },

        /**
         * Bind event handlers
         */
        bindEvents: function() {
            // Welcome step - backup acknowledge checkbox
            $('#backup-acknowledged').on('change', this.handleBackupAcknowledge.bind(this));

            // Welcome step - continue button
            $('#continue-from-welcome-btn').on('click', this.continueFromWelcome.bind(this));

            // Overview step - plugins list toggle
            $('#toggle-plugins-list').on('click', this.togglePluginsList.bind(this));

            // Overview step - suggested plugin actions
            $(document).on('click', '.creator-install-plugin', this.installPlugin.bind(this));
            $(document).on('click', '.creator-activate-plugin', this.activatePlugin.bind(this));
            $(document).on('click', '.creator-dismiss-suggestion', this.dismissPluginSuggestion.bind(this));

            // Overview step - backup configuration
            $('.creator-backup-option input[type="radio"]').on('change', this.handleBackupSelection.bind(this));

            // If on overview step, intercept the Continue link
            if (typeof creatorSetupData !== 'undefined' && creatorSetupData.currentStep === 'overview') {
                $('#next-step-btn').on('click', this.saveOverviewAndContinue.bind(this));
            }

            // License validation
            $('#validate-license-btn').on('click', this.validateLicense.bind(this));

            // Profile selection
            $('.creator-profile-option input[type="radio"]').on('change', this.handleProfileSelection.bind(this));

            // Model selection
            $('.creator-model-option input[type="radio"]').on('change', this.handleModelSelection.bind(this));

            // If on profile step, intercept the Continue button (now final step)
            if (typeof creatorSetupData !== 'undefined' && creatorSetupData.currentStep === 'profile') {
                $('#next-step-btn').on('click', this.saveProfileAndComplete.bind(this));
            }
        },

        /**
         * Initialize step-specific behavior
         */
        initializeStepSpecificBehavior: function() {
            if (typeof creatorSetupData === 'undefined') return;

            switch (creatorSetupData.currentStep) {
                case 'welcome':
                    // Disable continue button until checkbox is checked
                    this.updateWelcomeContinueState();
                    break;
                case 'overview':
                    // No special initialization needed
                    break;
            }
        },

        /**
         * Update welcome continue button state based on checkbox
         */
        updateWelcomeContinueState: function() {
            const $checkbox = $('#backup-acknowledged');
            const $btn = $('#continue-from-welcome-btn');

            if ($checkbox.is(':checked')) {
                $btn.prop('disabled', false).removeClass('disabled');
            } else {
                $btn.prop('disabled', true).addClass('disabled');
            }
        },

        /**
         * Handle backup acknowledge checkbox change
         */
        handleBackupAcknowledge: function(e) {
            this.updateWelcomeContinueState();
        },

        /**
         * Continue from welcome step
         */
        continueFromWelcome: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);

            // Show loading state
            $btn.prop('disabled', true);
            $btn.html('<span class="dashicons dashicons-update creator-spin"></span> Loading...');

            // Send AJAX request to log acknowledgment and continue
            $.ajax({
                url: creatorSetup.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_accept_safety',
                    nonce: creatorSetup.nonce,
                    accepted: 'true'
                },
                success: function(response) {
                    if (response.success) {
                        // Navigate to next step
                        const nextUrl = response.data?.next_url || creatorSetupData.nextUrl;
                        if (nextUrl) {
                            window.location.href = nextUrl;
                        } else {
                            window.location.href = creatorSetup.adminUrl + 'admin.php?page=creator-setup&step=overview';
                        }
                    } else {
                        $btn.prop('disabled', false);
                        $btn.html('Continue to Setup <span class="dashicons dashicons-arrow-right-alt2"></span>');
                    }
                },
                error: function() {
                    $btn.prop('disabled', false);
                    $btn.html('Continue to Setup <span class="dashicons dashicons-arrow-right-alt2"></span>');
                }
            });
        },

        /**
         * Handle backup option selection (visual feedback)
         */
        handleBackupSelection: function(e) {
            const $radio = $(e.currentTarget);
            const $option = $radio.closest('.creator-backup-option');

            // Remove selected class from all options
            $('.creator-backup-option').removeClass('selected');

            // Add selected class to current option
            $option.addClass('selected');
        },

        /**
         * Save overview step data (including chat backup config) and continue
         */
        saveOverviewAndContinue: function(e) {
            e.preventDefault();
            e.stopPropagation();

            const $btn = $(e.currentTarget);
            const retentionDays = $('#retention-days').val();
            const maxSizeMb = $('#max-size-mb').val();

            // Show loading
            $btn.addClass('loading').css('pointer-events', 'none');
            $btn.html('<span class="dashicons dashicons-update creator-spin"></span> Saving...');

            $.ajax({
                url: creatorSetup.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_process_step',
                    nonce: creatorSetup.nonce,
                    step: 'overview',
                    data: {
                        retention_days: retentionDays,
                        max_size_mb: maxSizeMb
                    }
                },
                success: function(response) {
                    if (response.success) {
                        const nextUrl = response.data?.next_url || creatorSetupData.nextUrl;
                        if (nextUrl) {
                            window.location.href = nextUrl;
                        }
                    } else {
                        alert('Failed to save configuration: ' + (response.data?.message || 'Unknown error'));
                        $btn.removeClass('loading').css('pointer-events', '');
                        $btn.html('Continue <span class="dashicons dashicons-arrow-right-alt2"></span>');
                    }
                },
                error: function() {
                    alert('Failed to save configuration. Please try again.');
                    $btn.removeClass('loading').css('pointer-events', '');
                    $btn.html('Continue <span class="dashicons dashicons-arrow-right-alt2"></span>');
                }
            });

            return false;
        },

        /**
         * Toggle plugins list visibility
         */
        togglePluginsList: function(e) {
            e.preventDefault();
            const $btn = $(e.currentTarget);
            const $content = $('#plugins-list-content');
            const $icon = $btn.find('.dashicons');

            $content.slideToggle(200, function() {
                if ($content.is(':visible')) {
                    $icon.removeClass('dashicons-arrow-down-alt2').addClass('dashicons-arrow-up-alt2');
                    $btn.find('span:not(.dashicons)').text('Hide installed plugins');
                } else {
                    $icon.removeClass('dashicons-arrow-up-alt2').addClass('dashicons-arrow-down-alt2');
                    $btn.find('span:not(.dashicons)').text('View installed plugins');
                }
            });
        },

        /**
         * Dismiss plugin suggestion
         */
        dismissPluginSuggestion: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const pluginSlug = $btn.data('plugin');
            const $item = $btn.closest('.creator-suggested-item');

            $.ajax({
                url: creatorSetup.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_dismiss_plugin_suggestion',
                    nonce: creatorSetup.nonce,
                    plugin: pluginSlug
                },
                success: function(response) {
                    if (response.success) {
                        $item.fadeOut(200, function() {
                            $(this).remove();
                            // If no more suggested plugins, hide the whole section
                            if ($('.creator-suggested-item').length === 0) {
                                $('.creator-suggested-plugins').fadeOut(200);
                            }
                        });
                    }
                }
            });
        },

        /**
         * Go to next step (server-side navigation)
         */
        nextStep: function(e) {
            e.preventDefault();
            e.stopPropagation();

            const $btn = $(e.currentTarget);

            console.log('Next button clicked');
            console.log('creatorSetupData:', typeof creatorSetupData !== 'undefined' ? creatorSetupData : 'undefined');

            // Get next URL from inline script variable
            if (typeof creatorSetupData !== 'undefined' && creatorSetupData.nextUrl) {
                const nextUrl = creatorSetupData.nextUrl;
                console.log('Navigating to:', nextUrl);

                $btn.prop('disabled', true);
                $btn.html('Loading... <span class="dashicons dashicons-update creator-spin"></span>');

                // Use direct navigation
                window.location.assign(nextUrl);
            } else {
                console.error('creatorSetupData.nextUrl not defined');
                alert('Error: Unable to navigate to next step. Please refresh the page.');
            }
        },

        /**
         * Validate license key
         */
        validateLicense: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const $input = $('#license-key');
            const $status = $('#license-status');
            const licenseKey = $input.val().trim();

            if (!licenseKey) {
                $status.html('<span class="creator-status-error"><span class="dashicons dashicons-warning"></span> Please enter a license key</span>');
                return;
            }

            // Show loading
            $btn.prop('disabled', true);
            $status.html('<span class="creator-pulse">Validating...</span>');

            $.ajax({
                url: creatorSetup.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_wizard_validate_license',
                    nonce: creatorSetup.nonce,
                    license_key: licenseKey
                },
                success: function(response) {
                    if (response.success) {
                        $status.html('<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> License valid</span>');
                        $input.prop('readonly', true);
                        $btn.text('Validated').prop('disabled', true);
                    } else {
                        $status.html('<span class="creator-status-error"><span class="dashicons dashicons-no"></span> ' + (response.data?.message || 'Invalid license') + '</span>');
                        $btn.prop('disabled', false);
                    }
                },
                error: function() {
                    $status.html('<span class="creator-status-error"><span class="dashicons dashicons-warning"></span> Validation failed</span>');
                    $btn.prop('disabled', false);
                }
            });
        },

        /**
         * Install plugin
         */
        installPlugin: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const pluginSlug = $btn.data('plugin');
            const $item = $btn.closest('.creator-suggested-item, .creator-plugin-item');

            // Show loading
            $btn.prop('disabled', true);
            $btn.html('<span class="dashicons dashicons-update creator-spin"></span> Installing...');

            $.ajax({
                url: creatorSetup.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_install_plugin',
                    nonce: creatorSetup.nonce,
                    plugin: pluginSlug
                },
                success: function(response) {
                    if (response.success) {
                        // Update UI for suggested plugins section
                        if ($item.hasClass('creator-suggested-item')) {
                            $btn.replaceWith('<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> Installed</span>');
                            $item.find('.status-not-installed').replaceWith('<span class="status-installed">Installed</span>');
                        } else {
                            // Legacy plugin item handling
                            $btn.remove();
                            $item.find('.creator-plugin-actions').html(
                                '<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> Installed</span>'
                            );
                            $item.addClass('active');
                            $item.find('.creator-plugin-status .dashicons')
                                .removeClass('status-inactive status-warning')
                                .addClass('status-ok');
                        }
                    } else {
                        $btn.html('Install');
                        $btn.prop('disabled', false);
                        alert('Installation failed: ' + (response.data?.message || 'Unknown error'));
                    }
                },
                error: function() {
                    $btn.html('Install');
                    $btn.prop('disabled', false);
                    alert('Installation failed. Please try again.');
                }
            });
        },

        /**
         * Activate plugin
         */
        activatePlugin: function(e) {
            e.preventDefault();

            const $btn = $(e.currentTarget);
            const pluginSlug = $btn.data('plugin');
            const $item = $btn.closest('.creator-suggested-item, .creator-plugin-item');

            // Show loading
            $btn.prop('disabled', true);
            $btn.html('<span class="dashicons dashicons-update creator-spin"></span> Activating...');

            $.ajax({
                url: creatorSetup.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_activate_plugin',
                    nonce: creatorSetup.nonce,
                    plugin: pluginSlug
                },
                success: function(response) {
                    if (response.success) {
                        // Update UI for suggested plugins section
                        if ($item.hasClass('creator-suggested-item')) {
                            $btn.replaceWith('<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> Active</span>');
                        } else {
                            // Legacy plugin item handling
                            $btn.parent().html(
                                '<span class="creator-status-ok"><span class="dashicons dashicons-yes"></span> Active</span>'
                            );
                            $item.addClass('active');
                            $item.find('.creator-plugin-status .dashicons')
                                .removeClass('status-inactive status-warning')
                                .addClass('status-ok');
                        }
                    } else {
                        $btn.html('Activate');
                        $btn.prop('disabled', false);
                        alert('Activation failed: ' + (response.data?.message || 'Unknown error'));
                    }
                },
                error: function() {
                    $btn.html('Activate');
                    $btn.prop('disabled', false);
                    alert('Activation failed. Please try again.');
                }
            });
        },

        /**
         * Handle profile selection (visual feedback)
         */
        handleProfileSelection: function(e) {
            const $radio = $(e.currentTarget);
            const $option = $radio.closest('.creator-profile-option');

            // Remove selected class from all options
            $('.creator-profile-option').removeClass('selected');

            // Add selected class to current option
            $option.addClass('selected');
        },

        /**
         * Handle model selection (visual feedback)
         */
        handleModelSelection: function(e) {
            const $radio = $(e.currentTarget);
            const $option = $radio.closest('.creator-model-option');

            // Remove selected class from all model options
            $('.creator-model-option').removeClass('selected');

            // Add selected class to current option
            $option.addClass('selected');
        },

        /**
         * Save profile and complete setup (profile is final step)
         */
        saveProfileAndComplete: function(e) {
            e.preventDefault();
            e.stopPropagation();

            const $btn = $(e.currentTarget);
            const selectedLevel = $('input[name="user_level"]:checked').val();
            const selectedModel = $('input[name="default_model"]:checked').val();

            // Validate selections
            if (!selectedLevel) {
                alert('Please select your competency level before continuing.');
                return false;
            }

            if (!selectedModel) {
                alert('Please select your default AI model before continuing.');
                return false;
            }

            // Show loading
            $btn.addClass('loading').css('pointer-events', 'none');
            $btn.html('<span class="dashicons dashicons-update creator-spin"></span> Completing setup...');

            $.ajax({
                url: creatorSetup.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'creator_process_step',
                    nonce: creatorSetup.nonce,
                    step: 'profile',
                    data: {
                        user_level: selectedLevel,
                        default_model: selectedModel
                    }
                },
                success: function(response) {
                    if (response.success) {
                        // Navigate to dashboard (setup complete!)
                        const nextUrl = response.data?.next_url || creatorSetup.adminUrl + 'admin.php?page=creator-dashboard';
                        window.location.href = nextUrl;
                    } else {
                        alert('Failed to save profile: ' + (response.data?.message || 'Unknown error'));
                        $btn.removeClass('loading').css('pointer-events', '');
                        $btn.html('Complete Setup <span class="dashicons dashicons-arrow-right-alt2"></span>');
                    }
                },
                error: function() {
                    alert('Failed to save profile. Please try again.');
                    $btn.removeClass('loading').css('pointer-events', '');
                    $btn.html('Complete Setup <span class="dashicons dashicons-arrow-right-alt2"></span>');
                }
            });

            return false;
        }
    };

    /**
     * Plugin Detector - checks plugin status on page load
     */
    const PluginDetector = {
        init: function() {
            // Plugin status is rendered server-side, no need for AJAX check
        }
    };

    // Initialize on document ready
    $(document).ready(function() {
        if ($('.creator-setup-wizard').length) {
            SetupWizard.init();
            PluginDetector.init();

            // Debug: log if variables are available
            if (typeof creatorSetup === 'undefined') {
                console.error('creatorSetup variable is not defined');
            }
            if (typeof creatorSetupData === 'undefined') {
                console.error('creatorSetupData variable is not defined');
            }
        }
    });

})(jQuery);
