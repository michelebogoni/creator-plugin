# AI Providers

This directory contains provider implementations for AI model APIs. Each provider is a wrapper that handles API calls, token counting, cost calculation, and error handling.

## Architecture

```
providers/
├── claude.ts      # Anthropic Claude provider
├── gemini.ts      # Google Gemini provider
├── openai.ts      # OpenAI provider (legacy)
└── index.ts       # Provider exports
```

## Provider Interface

All providers implement the `IAIProvider` interface from `../types/AIProvider.ts`:

```typescript
interface IAIProvider {
  /** Provider name identifier */
  readonly name: ProviderName;

  /** Generate content from a prompt */
  generate(prompt: string, options?: GenerateOptions): Promise<AIResponse>;

  /** Count tokens in a text */
  countTokens(text: string): Promise<number>;
}
```

## Available Providers

### Claude (`claude.ts`)
- **API**: Anthropic Claude API
- **Default Model**: `claude-opus-4-5-20251101`
- **Features**: Multimodal (images, PDFs), large context window
- **Retry Logic**: Exponential backoff on 429/529 errors

### Gemini (`gemini.ts`)
- **API**: Google Generative AI
- **Default Model**: `gemini-2.5-pro-preview-05-06`
- **Features**: Multimodal support, safety filtering
- **Retry Logic**: Exponential backoff on rate limits

### OpenAI (`openai.ts`)
- **API**: OpenAI Chat Completions
- **Status**: Legacy (not actively used in routing)

## Adding a New Provider

1. Create a new file: `newprovider.ts`

2. Implement the `IAIProvider` interface:

```typescript
import {
  IAIProvider,
  AIResponse,
  GenerateOptions,
  ProviderName,
} from "../types/AIProvider";

export class NewProvider implements IAIProvider {
  readonly name: ProviderName = "newprovider";

  constructor(apiKey: string, model?: string) {
    // Initialize client
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<AIResponse> {
    // Make API call
    // Handle errors
    // Return standardized response
  }

  async countTokens(text: string): Promise<number> {
    // Use tokenizer or API
  }
}
```

3. Add the provider name to `ProviderName` type in `../types/AIProvider.ts`

4. Export from `index.ts`

5. Update `ModelService` in `../services/modelService.ts` to use the new provider

## Error Handling

All providers return structured errors via `AIResponse`:

```typescript
{
  success: false,
  error: "Rate limited",
  error_code: "RATE_LIMITED"
}
```

Standard error codes:
- `RATE_LIMITED` - API rate limit hit
- `INVALID_API_KEY` - Authentication failed
- `PROVIDER_ERROR` - Server error (5xx)
- `TIMEOUT` - Request timeout
- `CONTENT_FILTERED` - Safety filter triggered
- `NETWORK_ERROR` - Connection failed

## Cost Calculation

Providers calculate costs using the `calculateCost()` function from `AIProvider.ts`:

```typescript
const cost = calculateCost(
  provider,       // "claude" | "gemini" | "openai"
  model,          // Specific model ID
  tokensInput,    // Input token count
  tokensOutput    // Output token count
);
```

Pricing is defined in `PRICING_TABLE` within `AIProvider.ts`.
