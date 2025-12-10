# Creator

AI-powered WordPress development assistant.

## Overview

Creator is a complete solution for AI-assisted WordPress development, consisting of:

| Component | Description | Location |
|-----------|-------------|----------|
| **AI Proxy** | Firebase Functions that securely route requests to AI providers | `functions/` |
| **WordPress Plugin** | Admin interface for interacting with AI | `packages/creator-core-plugin/` |

## Architecture

```
WordPress Site                    Cloud Infrastructure
┌─────────────────┐              ┌─────────────────┐              ┌─────────────┐
│                 │    HTTPS     │                 │    API       │             │
│  Creator Core   │ ───────────► │  Firebase       │ ───────────► │  Anthropic  │
│  (WP Plugin)    │              │  Functions      │              │  OpenAI     │
│                 │              │  (AI Proxy)     │              │  Google     │
└─────────────────┘              └─────────────────┘              └─────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- PHP 7.4+
- Composer
- Firebase CLI
- Google Cloud account

### Firebase Functions Setup

```bash
# Clone repository
git clone https://github.com/michelebogoni/creator.git
cd creator

# Install dependencies
cd functions
npm install

# Configure Firebase
firebase login
firebase use creator-ai-proxy

# Set up secrets (in Google Cloud Secret Manager)
# - JWT_SECRET
# - CLAUDE_API_KEY
# - OPENAI_API_KEY
# - GEMINI_API_KEY

# Deploy
firebase deploy --only functions
```

### WordPress Plugin Setup

```bash
# Build plugin
cd packages/creator-core-plugin/creator-core
composer install --no-dev

# Create ZIP
cd ../../..
zip -r creator-core.zip packages/creator-core-plugin/creator-core

# Install in WordPress
# Upload ZIP via Plugins > Add New > Upload Plugin
```

## Development

### Firebase Functions

```bash
cd functions
npm run lint          # Check code style
npm run test          # Run tests
npm run build         # Compile TypeScript
npm run serve         # Start local emulator
```

### WordPress Plugin

```bash
cd packages/creator-core-plugin/creator-core
composer install      # Install dependencies
vendor/bin/phpunit    # Run tests
```

## CI/CD Workflows

| Workflow | Trigger | Action |
|----------|---------|--------|
| `firebase-deploy.yml` | Push to `functions/**` | Deploy Firebase Functions |
| `test-plugin.yml` | Push to `packages/**` | Test WordPress plugin |
| `deploy-plugin.yml` | Tag `plugin-v*` | Release plugin ZIP |

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Project Structure](docs/PROJECT-STRUCTURE.md)

## Project Structure

```
creator/
├── functions/                    # Firebase Functions (AI Proxy)
├── packages/
│   └── creator-core-plugin/      # WordPress Plugin
├── .github/workflows/            # CI/CD pipelines
├── docs/                         # Documentation
├── firebase.json                 # Firebase config
└── README.md                     # This file
```

## Features

### AI Proxy (Firebase Functions)
- Multi-provider support (Claude, GPT, Gemini)
- License management
- Rate limiting & cost tracking
- Async job queue
- Usage analytics

### WordPress Plugin
- Chat-based AI interface
- One-click action execution
- Automatic backups before changes
- Rollback capability
- Audit logging
- Plugin integrations (Elementor, WooCommerce, ACF, etc.)

## Security

- API keys secured in Google Secret Manager
- JWT-based license validation
- WordPress nonce verification
- Capability-based access control
- Input sanitization & output escaping

## License

Proprietary - All rights reserved.

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/michelebogoni/creator/issues) page.
