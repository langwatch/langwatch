# Fetching LangWatch Docs Without MCP

If the MCP server cannot be installed, fetch documentation directly via HTTP.

## Integration Docs

1. Fetch the index: `https://langwatch.ai/docs/llms.txt`
2. Pick a topic from the listing
3. Fetch the page by appending `.md` (e.g., `https://langwatch.ai/docs/integration/python/guide.md`)

## Scenario (Agent Testing) Docs

1. Fetch the index: `https://langwatch.ai/scenario/llms.txt`
2. Follow the same pattern for individual pages

## Notes

- The MCP server is always preferred -- it provides richer tools beyond docs.
- Use `WebFetch` or `curl` to retrieve these URLs.
