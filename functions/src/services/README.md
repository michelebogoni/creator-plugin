# Services

This directory contains the business logic layer of the Creator AI Proxy. Services encapsulate complex operations and are consumed by API endpoints.

## Architecture

```
services/
├── modelService.ts         # AI model routing with fallback
├── licensing.ts            # License validation business logic
├── jobProcessor.ts         # Async job queue processing
├── aiRouter.ts             # Prompt validation and sanitization
├── costCalculator.ts       # Usage analytics and cost tracking
├── pluginDocsResearch.ts   # WordPress plugin documentation lookup
└── index.ts                # Service exports
```

## Service Overview

### `modelService.ts` - Model Service

Routes AI requests to providers with automatic fallback.

```typescript
const service = new ModelService(
  { gemini: apiKey, claude: apiKey },
  logger
);

const result = await service.generate({
  model: "claude",
  prompt: "Generate a WordPress page...",
  temperature: 0.7,
  max_tokens: 8000,
});

// Returns: { success, content, model, used_fallback, cost_usd, ... }
```

**Key Features:**
- Primary/fallback model selection
- Automatic retry on failure
- Cost tracking per request
- Token usage reporting

### `licensing.ts` - Licensing Service

Handles license validation, JWT generation, and quota management.

```typescript
const result = await processLicenseValidation(
  { license_key: "CREATOR-2024-XXXXX", site_url: "https://site.com" },
  jwtSecret,
  ipAddress,
  logger
);

// Returns: { success, site_token, plan, tokens_remaining, ... }
```

**Key Features:**
- License key format validation
- Site URL matching
- Quota checking
- JWT token generation/reuse
- Audit logging

### `jobProcessor.ts` - Job Processor

Processes async bulk tasks from the job queue.

```typescript
await processNextJob(logger);
```

**Supported Task Types:**
- `bulk_articles` - Generate multiple articles
- `bulk_products` - Generate product descriptions
- `design_batch` - Generate Elementor sections

**Job Lifecycle:**
1. `pending` - Queued for processing
2. `processing` - Currently being executed
3. `completed` - Successfully finished
4. `failed` - All retry attempts exhausted

### `aiRouter.ts` - AI Router

Validates and sanitizes user prompts before sending to AI.

```typescript
const validation = validatePrompt(prompt, MAX_LENGTH);
const sanitized = sanitizePrompt(prompt);
```

**Features:**
- Length validation
- Content sanitization
- XSS prevention
- Prompt injection detection

### `costCalculator.ts` - Cost Calculator

Tracks and calculates usage costs for analytics.

```typescript
const analytics = buildAnalyticsFromCostTracking(costDoc, licenseId, period, requestCounts);
const providerStats = calculateProviderStats(costDoc);
const comparison = calculatePeriodComparison(current, previous, currentReqs, prevReqs);
```

**Metrics Tracked:**
- Tokens by provider (input/output)
- Cost by provider (USD)
- Request counts
- Period-over-period comparison

### `pluginDocsResearch.ts` - Plugin Documentation Research

Fetches WordPress plugin documentation from various sources.

**Sources:**
- WordPress.org Plugin API
- Plugin README files
- Official documentation sites

## Service Dependencies

```
API Endpoints
     │
     ▼
  Services (this layer)
     │
     ├──► Providers (AI APIs)
     │
     ├──► Firestore (data persistence)
     │
     └──► External APIs (plugin docs, etc.)
```

## Adding a New Service

1. Create the service file with appropriate JSDoc:

```typescript
/**
 * @fileoverview Description of the service
 * @module services/myService
 */

export class MyService {
  constructor(private logger: Logger) {}

  async doSomething(input: InputType): Promise<OutputType> {
    // Business logic here
  }
}
```

2. Export from `index.ts`:

```typescript
export * from "./myService";
```

3. Add tests in `myService.test.ts`

## Error Handling

Services should return structured results rather than throwing errors:

```typescript
interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
```

This allows API endpoints to translate service results into appropriate HTTP responses.
