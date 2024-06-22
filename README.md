![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
[![Discord](https://dcbadge.limes.pink/api/server/https://discord.gg/kT4PhDS2gH?style=flat)](https://discord.gg/kT4PhDS2gH)
[![LangWatch Python SDK version](https://img.shields.io/pypi/v/langwatch?color=007EC6)](https://pypi.org/project/langwatch/)
[![LangWatch TypeScript SDK version](https://img.shields.io/npm/v/langwatch?color=007EC6)](https://www.npmjs.com/package/langwatch)

# LangWatch

## LLMOps Platform | DSPy Visualizer | Monitoring | Evaluations | Analytics

LangWatch provides a suite of tools to track, visualize, and analyze interactions with LLMs focused on usability, helping both developers and non-technical team members to fine-tune performance and gain insights into user engagement.

[https://langwatch.ai](https://langwatch.ai)

![langwatch](https://github.com/langwatch/langwatch/assets/792201/cced066c-92a8-4348-8b84-d9707c6cfc4e)

## Features

- ⚡️ **Real-time Telemetry**: Capture detailed interaction tracings for analytics for LLM cost, latency, and so on for further optimization.
- 🐛 **Detailed Debugging**: Capture every step in the chain of your LLM calls, with all metadata and history, grouping by threads and user for easy troubleshooting and reproduction.
- 📈 **Make LLM Quality Measurable**: Stop relying on just feeling and use Evaluators to measure your LLM pipeline output quality with numbers using [LangEvals evaluators](https://github.com/langwatch/langevals/) to improve your pipelines, change prompts and switch models with confidence.
- 📊 [**DSPy Visualizer**](https://docs.langwatch.ai/dspy-visualization/quickstart): Go a step further into finding the best prompts and pipelines automatically with DSPy optimizers, and plug it into LangWatch DSPy visualizer to very easily inspect and track the progress of your DSPy experiments, keeping the history and comparing runs to keep iterating.
- ✨ **Easier \~Vibe Checking\~ too**: Even though LangWatch helps grounding the quality into numbers and run automated experiments, a human look is still as important as ever. A clean, friendly interface focused on usability with automatic topic clustering, so you can deep dive on the messages being generated and really get a deep understanding of how your LLM is behaving, finding insights to iterate.
- 🚀 **User Analytics**: Metrics on engagement, user interactions and more insights into users behaviour so you can improve your product.
- 🛡️ **Guardrails**: Detect PII leak with Google DLP, toxic language with Azure Moderation and many others LangWatch Guardrails available to monitor your LLM outputs and trigger alerts. Build custom Guardrails yourself with semantic matching or another LLM on top evaluating the response.

## Quickstart (OpenAI Python)

Install LangWatch library:

```shell
pip install langwatch
```

Then add the `@langwatch.trace()` decorator to the function that triggers your llm pipeline:

```diff
+ import langwatch

+ @langwatch.trace()
  def main():
      client = OpenAI()
      ...
```

Now, enable autotracking of OpenAI calls for this trace with `autotrack_openai_calls()`:

```diff
  import langwatch

  @langwatch.trace()
  def main():
      client = OpenAI()
+     langwatch.get_current_trace().autotrack_openai_calls(client)

```

Next, you need to make sure to have LANGWATCH_API_KEY exported:

```bash
export LANGWATCH_API_KEY='your_api_key_here'
```

[Set up your project](https://app.langwatch.ai) on LangWatch to generate your API key.

That's it! All your LLM calls will now be automatically captured on LangWatch, for monitoring, analytics and evaluations.

For more advanced tracking and integration details of other languages like **TypeScript** and frameworks like **LangChain**, refer our [documentation](https://docs.langwatch.ai/).

## DSPy Visualizer Quickstart

Install LangWatch library:

```shell
pip install langwatch
```

Import and authenticate with your LangWatch key:

```python
import langwatch

langwatch.login()
```

Before your DSPy program compilation starts, initialize langwatch with your experiment name and the optimizer to be tracked:

```python
# Initialize langwatch for this run, to track the optimizer compilation
langwatch.dspy.init(experiment="my-awesome-experiment", optimizer=optimizer)

compiled_rag = optimizer.compile(RAG(), trainset=trainset)
```

That's it! Now open the link provided when the compilation starts or go to your LangWatch dashboard to follow the progress of your experiments:

![DSPy Visualizer](https://github.com/langwatch/langwatch/assets/792201/47312dfe-980f-4c09-9610-67ad064cbe86)

## Running Locally

You need to have docker and docker compose installed in your local environment to be able to run LangWatch locally.
Then, it's two simple steps:

1. Copy the `langwatch/.env.example` file to `langwatch/.env`

2. Run `docker compose up --build` and open LangWatch at http://localhost:3000

## Documentation

Detailed documentation is available to help you get the most out of LangWatch:

- [Introduction](https://docs.langwatch.ai/introduction)
- [Python Integration Guide](https://docs.langwatch.ai/integration/python/guide)
- [TypeScript Integration Guide](https://docs.langwatch.ai/integration/typescript/guide)
- [DSPy Visualization](https://docs.langwatch.ai/dspy-visualization/quickstart)
- [LangEvals Evaluators](https://docs.langwatch.ai/langevals/documentation/evaluators)
- [Triggers](https://docs.langwatch.ai/features/triggers)
- [Annotations](https://docs.langwatch.ai/features/annotations)
- [Datasets](https://docs.langwatch.ai/features/datasets)
- [Self-Hosting](https://docs.langwatch.ai/self-hosting)
- [Troubleshooting and Support](https://docs.langwatch.ai/support)

## Self-Hosting

For a more complete guide on how to self-host LangWatch, please refer to the [Self-Hosting](https://docs.langwatch.ai/self-hosting) section of the documentation.

## Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please read our [Contribution Guidelines](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests.
