<p align="center">
  <a href="https://langwatch.ai"><img src=".github/readme/cover.jpg" alt="LangWatch: the open-source platform for AI in production" width="100%"></a>
</p>

<p align="center">
<a href="https://discord.gg/kT4PhDS2gH" target="_blank"><img src="https://img.shields.io/discord/1227886780536324106?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord"></a>
<a href="https://pypi.org/project/langwatch/" target="_blank"><img src="https://img.shields.io/pypi/dm/langwatch?logo=python&logoColor=white&label=pypi%20langwatch&color=blue" alt="langwatch Python package on PyPi"></a>
<a href="https://www.npmjs.com/package/langwatch" target="_blank"><img src="https://img.shields.io/npm/dm/langwatch?logo=npm&logoColor=white&label=npm%20langwatch&color=blue" alt="langwatch npm package"></a>
<a href="https://twitter.com/intent/follow?screen_name=langwatchai" target="_blank"><img src="https://img.shields.io/twitter/follow/langwatchai?logo=X&color=%20%23f5f5f5" alt="follow on X"></a>
<img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise-blue" alt="Open-core: Apache 2.0 core + Enterprise extension">
</p>

<video src="https://github.com/user-attachments/assets/b0dee97b-b5be-43f8-9d08-18ae1201d017" autoplay loop muted playsinline width="100%" style="display: block; aspect-ratio: 16 / 9;"></video>

LangWatch is the open-source platform for AI in production. It traces, tests, routes and governs every LLM call in your company, from the agents you build to the coding assistants your engineers use. LangWatch is Apache 2.0.

## Get started

### LangWatch Cloud

Create an account. The product guides you from there.

<a href="https://app.langwatch.ai"><img src=".github/readme/signup.png" alt="Sign up" height="48"></a>

### Track your coding agents

One command, and every Claude Code, Codex, Copilot or opencode session shows up with its cost:

```bash
npx langwatch claude
```

### Self-host

Only Node.js is required:

```bash
npx @langwatch/server
```

LangWatch opens at `http://localhost:5560`. For production, see [Self-hosting LangWatch](https://langwatch.ai/docs/self-hosting/overview).

## What you get

<p align="center">
  <img src=".github/readme/areas.jpg" alt="The four areas of LangWatch: LLM Ops, Coding Agents, AI Gateway and AI Governance" width="100%">
</p>

- **[LLM Ops](https://langwatch.ai/docs/observability/overview)**: [Observability](https://langwatch.ai/docs/observability/overview), [Agent Testing](https://langwatch.ai/docs/agent-testing/overview), [Evaluations](https://langwatch.ai/docs/evaluations/overview) and [Prompt Management](https://langwatch.ai/docs/prompt-management/overview) for the agents you build.
- **[Coding Agents](https://langwatch.ai/docs/coding-agents/overview)**: what Claude Code, Codex, Copilot and opencode do and cost, per session, per pull request and per team, with privacy controls for the people who use them.
- **[AI Gateway](https://langwatch.ai/docs/ai-gateway/overview)**: one OpenAI and Anthropic compatible endpoint for every LLM call in the company, virtual keys with budgets, every request traced.
- **[AI Governance](https://langwatch.ai/docs/ai-governance/overview)**: an inventory of every AI tool in the company and who uses it, with anomaly rules on their activity.

## Integrations

**Coding assistants:** [Claude Code](https://langwatch.ai/docs/coding-agents/claude-code) · [Codex](https://langwatch.ai/docs/coding-agents/openai-codex) · [GitHub Copilot](https://langwatch.ai/docs/coding-agents/github-copilot-cli) · [opencode](https://langwatch.ai/docs/coding-agents/opencode) · [Cursor](https://langwatch.ai/docs/ai-gateway/quickstart) · [MCP server](https://langwatch.ai/docs/integration/mcp)

**Frameworks:** [LangChain](https://langwatch.ai/docs/integration/python/integrations/langchain) · [LangGraph](https://langwatch.ai/docs/integration/python/integrations/langgraph) · [Vercel AI SDK](https://langwatch.ai/docs/integration/typescript/integrations/vercel-ai-sdk) · [Mastra](https://langwatch.ai/docs/integration/typescript/integrations/mastra) · [CrewAI](https://langwatch.ai/docs/integration/python/integrations/crew-ai) · [Google ADK](https://langwatch.ai/docs/integration/python/integrations/google-ai) · [DSPy](https://langwatch.ai/docs/integration/python/integrations/dspy) · any [OpenTelemetry](https://langwatch.ai/docs/integration/opentelemetry/guide) source

**Model providers:** [OpenAI](https://langwatch.ai/docs/integration/python/integrations/open-ai) · [Anthropic](https://langwatch.ai/docs/integration/python/integrations/anthropic) · [Azure OpenAI](https://langwatch.ai/docs/integration/python/integrations/open-ai-azure) · [Vertex AI](https://langwatch.ai/docs/integration/python/integrations/vertex-ai) · [Bedrock](https://langwatch.ai/docs/integration/python/integrations/aws-bedrock)

**Governance sources:** [Copilot Studio](https://langwatch.ai/docs/ai-governance/ingestion-sources/copilot-studio) · [Claude Cowork](https://langwatch.ai/docs/ai-governance/ingestion-sources/claude-cowork) · [Anthropic](https://langwatch.ai/docs/ai-governance/ingestion-sources/claude-compliance) and [OpenAI](https://langwatch.ai/docs/ai-governance/ingestion-sources/openai-compliance) compliance APIs · [Workato](https://langwatch.ai/docs/ai-governance/ingestion-sources/workato) · Databricks Genie · [any OpenTelemetry or S3 audit feed](https://langwatch.ai/docs/ai-governance/ingestion-sources/index)

**No-code platforms:** [LangFlow](https://langwatch.ai/docs/integration/langflow) · [Flowise](https://langwatch.ai/docs/integration/flowise) · [n8n](https://langwatch.ai/docs/integration/n8n)

## Contributing

Read [CONTRIBUTING.md](https://github.com/langwatch/langwatch/blob/main/CONTRIBUTING.md), then start a development environment with `make quickstart`. Bugs and feature requests go in [GitHub issues](https://github.com/langwatch/langwatch/issues), questions in [Discord](https://discord.gg/kT4PhDS2gH).

<a href="https://github.com/langwatch/langwatch/graphs/contributors"><img src="https://contrib.rocks/image?repo=langwatch/langwatch&max=100" alt="LangWatch contributors"></a>

## License

LangWatch is Apache 2.0 and free to use, for individuals and for companies, self-hosted or not. The enterprise modules under [`platform/app/ee/`](platform/app/ee/) (SSO, SCIM provisioning, audit logs, gateway webhooks, billing, governance ingestion) are the one part that needs a commercial license in production, and the SDKs are MIT. See [Editions and licensing](https://langwatch.ai/docs/self-hosting/licensing) for what a license adds, and [`LICENSE.md`](LICENSE.md) for the per-folder breakdown.

## Security

LangWatch is GDPR compliant, with a DPA available on request, and ISO 27001 certified. To report a vulnerability, email [security@langwatch.ai](mailto:security@langwatch.ai) or reach a team member privately on [Discord](https://discord.gg/kT4PhDS2gH).
