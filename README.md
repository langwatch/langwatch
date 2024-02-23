![PyPI Version](https://img.shields.io/pypi/v/langwatch.svg)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

# LangWatch: LLM Monitoring & Analytics Platform

LangWatch provides a suite of tools to track, visualize, and analyze interactions with LLMs focused on usability, helping both developers and non-technical team members to fine-tune performance and gain insights into user engagement.

[https://langwatch.ai](https://langwatch.ai)

![langwatch](https://github.com/langwatch/langwatch/assets/792201/8689b780-b784-4840-b4ad-690aa6cc347f)

## Features

- ⚡️ **Real-time Telemetry**: Capture detailed interaction tracings for analytics for LLM cost, latency, and so on for further optimization.
- ✨ **Easier \~Vibe Checking\~**: A clean, friendly interface focused on usability with automatic topic clustering, so you can deep dive on the messages being generated and really get a deep understanding of how your LLM is behaving, finding insights to iterate.
- 🚀 **User Analytics**: Metrics on engagement, user interactions and more insights into users behaviour so you can improve your product.
- 🐛 **Detailed Debugging**: Capture every step in the chain of your LLM calls, with all metadata and history, grouping by threads and user for easy troubleshooting and reproduction.
- 🛡️ **Guardrails**: Detect PII leak with Google DLP, toxic language with Azure Moderation and many others LangWatch Guardrails available to monitor your LLM outputs and trigger alerts. Build custom Guardrails yourself with semantic matching or another LLM on top evaluating the response.

## Quickstart

LangWatch supports OpenAI and LangChain (more integrations soon).

Install LangWatch with pip:

```shell
pip install langwatch
```

Then simply wrap your LLM call with LangWatch tracer, no other code changes needed:

```diff
+ import langwatch.openai

+ with langwatch.openai.OpenAITracer(client):
      completion = client.chat.completions.create(
          model="gpt-3.5-turbo",
          messages=[
              {
                  "role": "system",
                  "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
              },
              {"role": "user", "content": message.content},
          ],
          stream=True,
      )
```

Next, you need to make sure to have LANGWATCH_API_KEY exported:

```bash
export LANGWATCH_API_KEY='your_api_key_here'
```

[Set up your project](https://app.langwatch.ai) on LangWatch to generate your API key.

For integration details of other LLMs and frameworks, refer our [documentation](https://docs.langwatch.ai/).

## Local Development

You need to have docker and docker compose installed in your local environment to be able to run LangWatch locally.

1. Duplicate (or rename) [.env.example](./langwatch/.env.example) to .env or .env.local file

2. Setup an [auth0](auth0.com) account (there should be a free plan and it should be more than enough).
    Create a simple app (for next.js) and take note of the credentials.
    You will use these credentials to update these env variables in .env file:

```
AUTH0_CLIENT_ID=""
AUTH0_CLIENT_SECRET=""
AUTH0_ISSUER="https://dev-frj2zgeo5352i1kj.us.auth0.com"
```

3. `docker compose up` should do the trick and get it working at http://localhost:3000 

## Documentation

Detailed documentation is available to help you get the most out of LangWatch:

- [Introduction](https://docs.langwatch.ai/docs/intro)
- [Getting Started](https://docs.langwatch.ai/docs/getting-started)
- [OpenAI Python Integration](https://docs.langwatch.ai/docs/integration-guides/open-ai)
- [LangChain Python Integration](https://docs.langwatch.ai/docs/integration-guides/langchain)
- [Custom REST Integration](https://docs.langwatch.ai/docs/integration-guides/custom-rest)
- [Concepts](https://docs.langwatch.ai/docs/concepts)
- [Troubleshooting and Support](https://docs.langwatch.ai/docs/support)

## Self-Hosting

LangWatch is open-source, self-hosting docs are still comming soon, however if you are interested already, [please reach out to us](mailto:rogerio@langwatch.ai).

## Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please read our [Contribution Guidelines](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests.
