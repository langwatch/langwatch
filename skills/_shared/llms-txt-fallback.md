# Fetching LangWatch Docs Without the CLI

The `langwatch` CLI is the preferred way to read docs (see [CLI Setup](cli-setup.md)). If you cannot run the CLI for some reason — for example you're inside ChatGPT, Claude on the web, or another assistant with no shell — fetch the same markdown files directly with HTTP.

1. Fetch the index: https://langwatch.ai/docs/llms.txt
2. Follow links to specific pages, appending `.md` extension
3. For Scenario docs: https://langwatch.ai/scenario/llms.txt

Example flow:
1. Fetch https://langwatch.ai/docs/llms.txt to see available topics
2. Fetch https://langwatch.ai/docs/integration/python/guide.md for Python instrumentation
3. Fetch https://langwatch.ai/docs/integration/typescript/guide.md for TypeScript instrumentation
