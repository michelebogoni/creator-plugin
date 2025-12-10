-- Creator Core Database Schema
-- Version: 1.0.0
-- WordPress tables prefix: wp_ (configurable)

-- ============================================
-- Table: wp_creator_chats
-- Stores chat sessions between users and AI
-- ============================================
CREATE TABLE IF NOT EXISTS wp_creator_chats (
    id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
    user_id bigint(20) unsigned NOT NULL,
    title varchar(255) DEFAULT '',
    status varchar(20) DEFAULT 'active',
    performance_tier varchar(20) DEFAULT 'flow',
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY user_id (user_id),
    KEY status (status),
    KEY performance_tier (performance_tier),
    KEY created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Table: wp_creator_messages
-- Stores individual messages within chats
-- ============================================
CREATE TABLE IF NOT EXISTS wp_creator_messages (
    id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
    chat_id bigint(20) unsigned NOT NULL,
    user_id bigint(20) unsigned NOT NULL,
    role varchar(20) DEFAULT 'user',
    content longtext,
    message_type varchar(20) DEFAULT 'text',
    metadata longtext,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY chat_id (chat_id),
    KEY user_id (user_id),
    KEY role (role),
    KEY created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Table: wp_creator_actions
-- Stores executed actions from AI responses
-- ============================================
CREATE TABLE IF NOT EXISTS wp_creator_actions (
    id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
    message_id bigint(20) unsigned NOT NULL,
    action_type varchar(255) NOT NULL,
    target varchar(255) DEFAULT '',
    status varchar(20) DEFAULT 'pending',
    error_message longtext,
    snapshot_id bigint(20) unsigned DEFAULT NULL,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    completed_at datetime DEFAULT NULL,
    PRIMARY KEY (id),
    KEY message_id (message_id),
    KEY action_type (action_type),
    KEY status (status),
    KEY snapshot_id (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Table: wp_creator_snapshots
-- Stores delta snapshots for rollback capability
-- ============================================
CREATE TABLE IF NOT EXISTS wp_creator_snapshots (
    id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
    chat_id bigint(20) unsigned NOT NULL,
    message_id bigint(20) unsigned DEFAULT NULL,
    action_id bigint(20) unsigned DEFAULT NULL,
    snapshot_type varchar(20) DEFAULT 'DELTA',
    operations longtext,
    storage_file varchar(500) DEFAULT '',
    storage_size_kb int(11) DEFAULT 0,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    deleted tinyint(1) DEFAULT 0,
    deleted_at datetime DEFAULT NULL,
    PRIMARY KEY (id),
    KEY chat_id (chat_id),
    KEY message_id (message_id),
    KEY action_id (action_id),
    KEY deleted (deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Table: wp_creator_audit_log
-- Stores complete audit trail of all operations
-- ============================================
CREATE TABLE IF NOT EXISTS wp_creator_audit_log (
    id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
    user_id bigint(20) unsigned NOT NULL,
    action varchar(255) NOT NULL,
    operation_id bigint(20) unsigned DEFAULT NULL,
    details longtext,
    ip_address varchar(45) DEFAULT '',
    status varchar(20) DEFAULT 'success',
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY user_id (user_id),
    KEY action (action),
    KEY status (status),
    KEY created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Table: wp_creator_backups
-- Stores backup file references
-- ============================================
CREATE TABLE IF NOT EXISTS wp_creator_backups (
    id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
    chat_id bigint(20) unsigned NOT NULL,
    file_path varchar(500) DEFAULT '',
    file_size_kb int(11) DEFAULT 0,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    expires_at datetime DEFAULT NULL,
    PRIMARY KEY (id),
    KEY chat_id (chat_id),
    KEY expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Table: wp_creator_thinking_logs
-- Stores Creator's reasoning process for transparency
-- Milestone 8: Thinking Process Transparency
-- ============================================
CREATE TABLE IF NOT EXISTS wp_creator_thinking_logs (
    id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
    chat_id bigint(20) unsigned NOT NULL,
    message_id bigint(20) unsigned DEFAULT NULL,
    logs longtext NOT NULL COMMENT 'JSON array of thinking log entries',
    summary longtext COMMENT 'JSON summary statistics',
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    duration_ms int(11) DEFAULT 0 COMMENT 'Total processing time in milliseconds',
    PRIMARY KEY (id),
    KEY chat_id (chat_id),
    KEY message_id (message_id),
    KEY created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
