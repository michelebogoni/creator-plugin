<?php
/**
 * Database Migrations
 *
 * @package CreatorCore
 */

namespace CreatorCore\Database;

defined( 'ABSPATH' ) || exit;

/**
 * Class Migrations
 *
 * Handles database schema migrations
 */
class Migrations {

    /**
     * Current database version
     *
     * @var string
     */
    private string $current_version;

    /**
     * Target database version
     *
     * @var string
     */
    private string $target_version;

    /**
     * Constructor
     */
    public function __construct() {
        $this->current_version = get_option( 'creator_core_db_version', '0.0.0' );
        $this->target_version  = CREATOR_CORE_VERSION;
    }

    /**
     * Check if migration is needed
     *
     * @return bool
     */
    public function needs_migration(): bool {
        return version_compare( $this->current_version, $this->target_version, '<' );
    }

    /**
     * Run migrations
     *
     * @return bool
     */
    public function run(): bool {
        if ( ! $this->needs_migration() ) {
            return true;
        }

        $migrations = $this->get_migrations();

        foreach ( $migrations as $version => $callback ) {
            if ( version_compare( $this->current_version, $version, '<' ) ) {
                $result = call_user_func( $callback );
                if ( ! $result ) {
                    return false;
                }
                update_option( 'creator_core_db_version', $version );
            }
        }

        return true;
    }

    /**
     * Get available migrations
     *
     * @return array
     */
    private function get_migrations(): array {
        return [
            '1.0.0' => [ $this, 'migrate_1_0_0' ],
            '1.1.0' => [ $this, 'migrate_1_1_0' ],
            '1.2.0' => [ $this, 'migrate_1_2_0' ],
        ];
    }

    /**
     * Migration for version 1.0.0
     *
     * Initial database setup (handled by Activator)
     *
     * @return bool
     */
    private function migrate_1_0_0(): bool {
        // Initial setup is handled by Activator::create_tables()
        // This migration is here for completeness and future reference
        return true;
    }

    /**
     * Migration for version 1.1.0
     *
     * Adds performance_tier column to chats table for AI processing tiers
     *
     * @return bool
     */
    private function migrate_1_1_0(): bool {
        global $wpdb;

        $table_name = $wpdb->prefix . 'creator_chats';

        // Check if column already exists
        $column_exists = $wpdb->get_results(
            $wpdb->prepare(
                "SHOW COLUMNS FROM {$table_name} LIKE %s",
                'performance_tier'
            )
        );

        if ( empty( $column_exists ) ) {
            // Add performance_tier column
            $wpdb->query(
                "ALTER TABLE {$table_name}
                 ADD COLUMN performance_tier varchar(20) DEFAULT 'flow' AFTER status,
                 ADD KEY performance_tier (performance_tier)"
            );
        }

        return true;
    }

    /**
     * Migration for version 1.2.0
     *
     * Converts performance_tier column to ai_model for simplified model selection
     * Maps: flow -> gemini, craft -> gemini (both map to gemini as new default)
     *
     * @return bool
     */
    private function migrate_1_2_0(): bool {
        global $wpdb;

        $table_name = $wpdb->prefix . 'creator_chats';

        // Check if performance_tier column exists (old column)
        $old_column_exists = $wpdb->get_results(
            $wpdb->prepare(
                "SHOW COLUMNS FROM {$table_name} LIKE %s",
                'performance_tier'
            )
        );

        // Check if ai_model column already exists (new column)
        $new_column_exists = $wpdb->get_results(
            $wpdb->prepare(
                "SHOW COLUMNS FROM {$table_name} LIKE %s",
                'ai_model'
            )
        );

        // Add new ai_model column if it doesn't exist
        if ( empty( $new_column_exists ) ) {
            $wpdb->query(
                "ALTER TABLE {$table_name}
                 ADD COLUMN ai_model varchar(20) DEFAULT 'gemini' AFTER status"
            );

            // Add index
            $wpdb->query(
                "ALTER TABLE {$table_name}
                 ADD KEY ai_model (ai_model)"
            );

            // Migrate data: all old tiers become gemini (the new default)
            $wpdb->query(
                "UPDATE {$table_name} SET ai_model = 'gemini'"
            );
        }

        // Drop old performance_tier column and index if they exist
        if ( ! empty( $old_column_exists ) ) {
            // Drop the index first (if exists)
            $index_exists = $wpdb->get_results(
                "SHOW INDEX FROM {$table_name} WHERE Key_name = 'performance_tier'"
            );

            if ( ! empty( $index_exists ) ) {
                $wpdb->query( "ALTER TABLE {$table_name} DROP KEY performance_tier" );
            }

            // Drop the column
            $wpdb->query( "ALTER TABLE {$table_name} DROP COLUMN performance_tier" );
        }

        // Migrate the user preference option
        $old_tier = get_option( 'creator_default_tier' );
        if ( $old_tier !== false ) {
            // Map old tier to model (gemini as default)
            update_option( 'creator_default_model', 'gemini' );
            delete_option( 'creator_default_tier' );
        }

        return true;
    }

    /**
     * Verify all tables exist
     *
     * @return array Array of missing tables
     */
    public function verify_tables(): array {
        global $wpdb;

        $required_tables = [
            $wpdb->prefix . 'creator_chats',
            $wpdb->prefix . 'creator_messages',
            $wpdb->prefix . 'creator_actions',
            $wpdb->prefix . 'creator_snapshots',
            $wpdb->prefix . 'creator_audit_log',
            $wpdb->prefix . 'creator_backups',
        ];

        $missing = [];

        foreach ( $required_tables as $table ) {
            $exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );
            if ( $exists !== $table ) {
                $missing[] = $table;
            }
        }

        return $missing;
    }

    /**
     * Get table row counts
     *
     * @return array
     */
    public function get_table_stats(): array {
        global $wpdb;

        $tables = [
            'chats'     => $wpdb->prefix . 'creator_chats',
            'messages'  => $wpdb->prefix . 'creator_messages',
            'actions'   => $wpdb->prefix . 'creator_actions',
            'snapshots' => $wpdb->prefix . 'creator_snapshots',
            'audit_log' => $wpdb->prefix . 'creator_audit_log',
            'backups'   => $wpdb->prefix . 'creator_backups',
        ];

        $stats = [];

        foreach ( $tables as $name => $table ) {
            $count = $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
            $stats[ $name ] = (int) $count;
        }

        return $stats;
    }
}
