<img width="1212" height="395" alt="012d1688-24ae-4759-ae70-5f8f81a13c0e" src="https://github.com/user-attachments/assets/27b6e50e-efde-41cf-9f7c-94b829b25a8c" />


<h3 align="center">
    <a href="https://langwatch.ai">Website</a> · <a href="https://docs.langwatch.ai">Docs</a> · <a href="https://discord.gg/kT4PhDS2gH">Discord</a> · <a href="https://docs.langwatch.ai/self-hosting/overview">Self-hosting</a>
</h3>

<p align="center">
<a href="https://discord.gg/kT4PhDS2gH" target="_blank"><img src="https://img.shields.io/discord/1227886780536324106?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord"></a>
<a href="https://pypi.python.org/pypi/langwatch" target="_blank"><img src="https://img.shields.io/pypi/dm/langwatch?logo=python&logoColor=white&label=pypi%20langwatch&color=blue" alt="langwatch Python package on PyPi"></a>
<a href="https://www.npmjs.com/package/langwatch" target="_blank"><img src="https://img.shields.io/npm/dm/langwatch?logo=npm&logoColor=white&label=npm%20langwatch&color=blue" alt="langwatch npm package"></a>
<a href="https://twitter.com/intent/follow?screen_name=langwatchai" target="_blank">
   <img src="https://img.shields.io/twitter/follow/langwatchai?logo=X&color=%20%23f5f5f5"
      alt="follow on X"></a>
</p>

<video src="https://github.com/user-attachments/assets/ff49882d-4e9d-4b7c-819b-be690fba9387" autoplay loop muted playsinline width="100%" style="display: block; aspect-ratio: 16 / 9;"></video>

## Why LangWatch?

The platform for LLM evaluations and AI agent testing.
We help teams test, simulate, evaluate, and monitor LLM-powered agents end-to-end — before release and in production.
Built for teams that need regression testing, simulations, and production observability without building custom tooling.

- [**End-to-end agent simulations**](https://langwatch.ai/scenario/)
  Run realistic scenarios against your **full stack** (tools, state, user simulator, judge) and pinpoint where your agents break, and why? down to each decision.

- **Eval + observability + prompts in one loop**
  [Trace](https://docs.langwatch.ai/integration/overview) → [dataset](https://docs.langwatch.ai/datasets/overview) → [evaluate](https://docs.langwatch.ai/llm-evaluation/offline-evaluation) → [optimize prompts/models](https://docs.langwatch.ai/optimization-studio/overview) → re-test. No glue code, no tool sprawl.

- [**Open standards, no lock-in**](https://docs.langwatch.ai/integration/opentelemetry/guide)
  OpenTelemetry/OTLP-native. Framework- and LLM-provider agnostic by design.

- [**Collaboration that doesn't slow shipping**](https://docs.langwatch.ai/features/annotations)
  Review runs, annotate failures, and ship fixes faster. Let domain experts label edge cases with [annotations & queues](https://docs.langwatch.ai/features/annotations), keep prompts in Git with the [GitHub integration](https://docs.langwatch.ai/prompt-management/features/essential/github-integration), and [link prompt versions to traces](https://docs.langwatch.ai/prompt-management/features/advanced/link-to-traces).

LangWatch gives you full visibility into agent behavior and the tools to systematically improve reliability, performance, and cost, while keeping you in control of your AI system

## Getting Started

### Cloud ☁️

The easiest way to get started with LangWatch.

[Create a free account](https://app.langwatch.ai) → create a project → get started/ copy your API key.

### Local setup 💻

Get up and running on your own machine using docker compose:

```bash
git clone https://github.com/langwatch/langwatch.git
cd langwatch
cp langwatch/.env.example langwatch/.env
docker compose up -d --wait --build
```
Once running, LangWatch will be available at `http://localhost:5560`, where you can create your first project and API key.

### Deployment options ⚓️

Run LangWatch on your own infrastructure:

- [Docker Compose](https://docs.langwatch.ai/self-hosting/open-source#docker-compose) - Run LangWatch on your own machine.
- [Kubernetes (Helm)](https://docs.langwatch.ai/self-hosting/open-source#helm-chart-for-langwatch) - Run LangWatch on a Kubernetes cluster using Helm.
- [OnPrem](https://docs.langwatch.ai/self-hosting/onprem) - Cloud-specific setups for AWS, Google Cloud, and Azure.

<details>
<summary>Hybrid (OnPrem data) 🔀</summary>

For companies that have strict data residency and control requirements, without needing to go fully on-prem.

Read more about it on our [docs](https://docs.langwatch.ai/self-hosting/hybrid).

</details>

<details>
<summary>Local Development 👩‍💻</summary>

You can also run LangWatch locally without docker to develop and help contribute to the project.

Start just the databases using docker and leave it running:

```bash
docker compose up redis postgres opensearch
```

Then, on another terminal, install the dependencies and start LangWatch:

```bash
make install
make start
```

</details>

## 🚀 Quick Start

Ship safer agents in minutes. [Create a free account](https://app.langwatch.ai), then dive into these guides:

- **[Run your first agent simulation](https://langwatch.ai/scenario/introduction/getting-started)** - Test agents against realistic scenarios before production
- **[Set up evaluations](https://docs.langwatch.ai/llm-evaluation/offline-evaluation)** - Measure quality, performance, and reliability
- **[Send your first traces](https://docs.langwatch.ai/integration/overview)** - Integrate LangWatch with your stack
- **[Get started with LangWatch MCP](https://langwatch.ai/docs/integration/mcp)** - Use LangWatch in Claude Desktop and other MCP clients

## 🗺️ Integrations


LangWatch builds and maintains several integrations listed below. Our tracing platform is built on top of [OpenTelemetry](https://opentelemetry.io/), so we support any OpenTelemetry-compatible library out of the box.

**Frameworks:**  
[LangChain](https://langwatch.ai/docs/integration/python/integrations/langchain) ·
[LangGraph](https://langwatch.ai/docs/integration/python/integrations/langgraph) ·
[Vercel AI SDK](https://langwatch.ai/docs/integration/typescript/integrations/vercel-ai) ·
[Mastra](https://langwatch.ai/docs/integration/typescript/integrations/mastra) ·
[CrewAI](https://langwatch.ai/docs/integration/python/integrations/crewai) ·
[Google ADK](https://langwatch.ai/docs/integration/python/integrations/google-ai)

**Model Providers:**  
[OpenAI](https://langwatch.ai/docs/integration/python/integrations/openai) ·
[Anthropic](https://langwatch.ai/docs/integration/python/integrations/anthropic) ·
[Azure](https://langwatch.ai/docs/integration/python/integrations/azure) ·
[Google Cloud](https://langwatch.ai/docs/integration/python/integrations/google-cloud) ·
[AWS](https://langwatch.ai/docs/integration/python/integrations/aws) ·
[Groq](https://langwatch.ai/docs/integration/python/integrations/groq) ·
[Ollama](https://langwatch.ai/docs/integration/python/integrations/ollama)

### Platforms

[LangFlow](https://docs.langwatch.ai/integration/langflow) · [Flowise](https://docs.langwatch.ai/integration/flowise) · [n8n](https://docs.langwatch.ai/integration/n8n)

*and many more…*

Are you using a platform that could benefit from a direct LangWatch integration? We'd love to hear from you, please [**fill out this very quick form.**](https://www.notion.so/1e35e165d48280468247fcbdc3349077?pvs=21)

## 💬 Support

Have questions or need help? We're here to support you in multiple ways:

- **Documentation:** Our comprehensive [documentation](https://docs.langwatch.ai) covers everything from getting started to advanced features.
- **Discord Community:** Join our [Discord server](https://discord.gg/kT4PhDS2gH) for real-time help from our team and community.
- **X (Twitter):** Follow us on [X](https://x.com/LangWatchAI) for updates and announcements.
- **GitHub Issues:** Report bugs or request features through our [GitHub repository](https://github.com/langwatch/langwatch).
- **Enterprise Support:** Enterprise customers receive priority support with dedicated response times. Our [pricing page](https://langwatch.ai/pricing) contains more information.

## 🤝 Collaborating

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please read our [Contribution Guidelines](https://github.com/langwatch/langwatch/blob/main/CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests.

## ✍️ License

Please read our [LICENSE.md](/LICENSE.md) file.

## 👮‍♀️ Security + Compliance

As a platform that has access to data that is highly likely to be sensitive, we take security incredibly seriously and treat it as a core part of our culture.

| Legal Framework | Current Status                                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| GDPR            | Compliant. DPA available upon request.                                         |
| ISO 27001       | Certified. Certification report available upon request on our Enterprise plan. |

Please refer to our Security page for more information. Contact us at [security@langwatch.ai](mailto:security@langwatch.ai) if you have any further questions.

### Vulnerability Disclosure

If you need to do a responsible disclosure of a security vulnerability, you may do so by email to [security@langwatch.ai](mailto:security@langwatch.ai), or if you prefer you can reach out to one of our team privately on [Discord](https://discord.com/invite/kT4PhDS2gH).
