<p align="center">
  <a href="https://langwatch.ai"><img src=".github/readme/cover.jpg" alt="LangWatch: the open-source platform for AI in production" width="100%"></a>
</p>

<h3 align="center">
    <a href="https://langwatch.ai">Website</a> · <a href="https://langwatch.ai/docs">Docs</a> · <a href="https://app.langwatch.ai">Cloud</a> · <a href="https://langwatch.ai/docs/self-hosting/overview">Self-hosting</a> · <a href="https://discord.gg/kT4PhDS2gH">Discord</a>
</h3>

<p align="center">
<a href="https://discord.gg/kT4PhDS2gH" target="_blank"><img src="https://img.shields.io/discord/1227886780536324106?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord"></a>
<a href="https://pypi.org/project/langwatch/" target="_blank"><img src="https://img.shields.io/pypi/dm/langwatch?logo=python&logoColor=white&label=pypi%20langwatch&color=blue" alt="langwatch Python package on PyPi"></a>
<a href="https://www.npmjs.com/package/langwatch" target="_blank"><img src="https://img.shields.io/npm/dm/langwatch?logo=npm&logoColor=white&label=npm%20langwatch&color=blue" alt="langwatch npm package"></a>
<a href="https://twitter.com/intent/follow?screen_name=langwatchai" target="_blank"><img src="https://img.shields.io/twitter/follow/langwatchai?logo=X&color=%20%23f5f5f5" alt="follow on X"></a>
<img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise-blue" alt="Open-core: Apache 2.0 core + Enterprise extension">
</p>

<video src="https://github.com/user-attachments/assets/b0dee97b-b5be-43f8-9d08-18ae1201d017" autoplay loop muted playsinline width="100%" style="display: block; aspect-ratio: 16 / 9;"></video>

LangWatch is the open-source platform for AI in production. It traces, tests, routes and governs every LLM call in your company, from the agents you build to the coding assistants your engineers use. The Apache 2.0 core is what runs [LangWatch Cloud](https://app.langwatch.ai), and you can self-host the same codebase.

## What you get

Four areas. Each one works on its own, and they share one account, one set of traces and one gateway.

**LLM Ops.** Everything to ship and improve an LLM application:

- [Observability](https://langwatch.ai/docs/observability/overview): every LLM call, tool call and user interaction as a trace, built on OpenTelemetry.
- [Agent Testing](https://langwatch.ai/docs/agent-testing/overview): multi-turn scenarios against your real agent, with a simulated user and a judge.
- [Evaluations](https://langwatch.ai/docs/evaluations/overview): experiments on datasets, and monitors on production traffic.
- [Prompt Management](https://langwatch.ai/docs/prompt-management/overview): versioned prompts your code loads at runtime.

**[Coding Agents](https://langwatch.ai/docs/coding-agents/overview).** What Claude Code, Codex, Copilot, Gemini CLI and opencode do and cost, per session, per pull request and per team, with privacy controls for the people who use them.

**[AI Gateway](https://langwatch.ai/docs/ai-gateway/overview).** One OpenAI and Anthropic compatible endpoint for every LLM call in the company. Provider keys stay in LangWatch, each caller gets a virtual key with its own budget, and every request lands as a trace.

**[AI Governance](https://langwatch.ai/docs/ai-governance/overview).** An inventory of every AI tool in the company and who uses it, anomaly rules on their activity, and a personal home page for each developer.

## Get started

**Use LangWatch Cloud.** [Sign up](https://app.langwatch.ai) for the free plan and create a project. Then let your coding agent do the setup:

```bash
npx skills add langwatch/skills/tracing
```

Run `/tracing` in Claude Code, Cursor or Codex and it instruments your code. Prefer to do it by hand? Follow the [quick start](https://langwatch.ai/docs/integration/quick-start) with the Python, TypeScript or Go SDK, or pick any of the [skills](https://langwatch.ai/docs/skills/directory) for evaluations, agent testing and prompt management.

**Track your coding agents.** One command per agent, and every session shows up with its cost:

```bash
npx langwatch claude    # also: codex, copilot, gemini, opencode
```

**Route calls through the gateway.** [Create a virtual key](https://langwatch.ai/docs/ai-gateway/quickstart), point your OpenAI or Anthropic SDK at `https://gateway.langwatch.ai/v1`, and send a request.

**Run it yourself.** Only Node.js is required:

```bash
npx @langwatch/server
```

This installs Postgres, Redis, ClickHouse and the gateway under `~/.langwatch/`, starts everything and opens `http://localhost:5560`. For production, see [Docker Compose](https://langwatch.ai/docs/self-hosting/deployment/docker-compose), [Kubernetes with Helm](https://langwatch.ai/docs/self-hosting/deployment/kubernetes-helm), the [on-prem architecture](https://langwatch.ai/docs/self-hosting/infrastructure/architecture) for AWS, Google Cloud and Azure, or the [hybrid setup](https://langwatch.ai/docs/hybrid-setup/overview) that keeps your data on your side.

## Integrations

LangWatch is built on OpenTelemetry, so anything that emits OTLP traces works out of the box. There are guides for [LangChain](https://langwatch.ai/docs/integration/python/integrations/langchain), [LangGraph](https://langwatch.ai/docs/integration/python/integrations/langgraph), [Vercel AI SDK](https://langwatch.ai/docs/integration/typescript/integrations/vercel-ai-sdk), [Mastra](https://langwatch.ai/docs/integration/typescript/integrations/mastra), [CrewAI](https://langwatch.ai/docs/integration/python/integrations/crew-ai), [Google ADK](https://langwatch.ai/docs/integration/python/integrations/google-ai), [DSPy](https://langwatch.ai/docs/integration/python/integrations/dspy), [OpenAI](https://langwatch.ai/docs/integration/python/integrations/open-ai), [Anthropic](https://langwatch.ai/docs/integration/python/integrations/anthropic), [Azure OpenAI](https://langwatch.ai/docs/integration/python/integrations/open-ai-azure), [Vertex AI](https://langwatch.ai/docs/integration/python/integrations/vertex-ai), [Bedrock](https://langwatch.ai/docs/integration/python/integrations/aws-bedrock), and the no-code platforms [LangFlow](https://langwatch.ai/docs/integration/langflow), [Flowise](https://langwatch.ai/docs/integration/flowise) and [n8n](https://langwatch.ai/docs/integration/n8n). The [MCP server](https://langwatch.ai/docs/integration/mcp) gives your coding assistant the same access to traces, evaluations and prompts.

## Contributing

Read [CONTRIBUTING.md](https://github.com/langwatch/langwatch/blob/main/CONTRIBUTING.md), then start a development environment with `make quickstart`. Bugs and feature requests go in [GitHub issues](https://github.com/langwatch/langwatch/issues), questions in [Discord](https://discord.gg/kT4PhDS2gH).

## License

LangWatch is Apache 2.0 and free to use, for individuals and for companies, self-hosted or not. The enterprise modules under [`platform/app/ee/`](platform/app/ee/) (SSO, SCIM provisioning, audit logs, gateway webhooks, billing, governance ingestion) are the one part that needs a commercial license in production, and the SDKs are MIT. See [Editions and licensing](https://langwatch.ai/docs/self-hosting/licensing) for what a license adds, and [`LICENSE.md`](LICENSE.md) for the per-folder breakdown.

## Security

LangWatch is GDPR compliant, with a DPA available on request, and ISO 27001 certified. To report a vulnerability, email [security@langwatch.ai](mailto:security@langwatch.ai) or reach a team member privately on [Discord](https://discord.gg/kT4PhDS2gH).
