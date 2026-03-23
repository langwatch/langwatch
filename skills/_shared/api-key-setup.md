# LangWatch API Key Setup

1. First, check if `LANGWATCH_API_KEY` is already in the project's `.env` file
2. If not found, ask the user for their API key — they can get one at https://app.langwatch.ai/authorize
3. Save to the project's `.env` file:
```
LANGWATCH_API_KEY=your-api-key-here
```
4. If `LANGWATCH_ENDPOINT` is set in `.env`, the user is on a self-hosted instance — use that endpoint for all LangWatch URLs instead of `app.langwatch.ai`
