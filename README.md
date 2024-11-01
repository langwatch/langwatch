![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
[![Discord](https://dcbadge.limes.pink/api/server/https://discord.gg/kT4PhDS2gH?style=flat)](https://discord.gg/kT4PhDS2gH)
[![LangWatch Python SDK version](https://img.shields.io/pypi/v/langwatch?color=007EC6)](https://pypi.org/project/langwatch/)
[![LangWatch TypeScript SDK version](https://img.shields.io/npm/v/langwatch?color=007EC6)](https://www.npmjs.com/package/langwatch)

# LangWatch - LLM Optimization Studio

LangWatch is a visual interface for [DSPy](https://github.com/stanfordnlp/dspy) and a complete LLM Ops platform for experimenting, measuring and improving LLM pipelines, with a [fair-code](https://faircode.io/) distribution model.

![LangWatch Optimization Studio Screenshot](https://github.com/user-attachments/assets/72d12686-d70b-471b-ab20-0ddfbbc65cff)

## Demo

[📺 Short video (3 min)](https://www.youtube.com/watch?v=dZG44oRTz84) for a sneak peak of LangWatch and a brief introduction to the concepts.

## Features

### 🎯 Optimization Studio
- Drag-and-drop interface for LLM pipeline optimization
- Built on Stanford's DSPy framework
- Automatic prompt and few-shot examples generation
- Visual experiment tracking and version control

### 📊 Quality Assurance
- 30+ off-the-shelf evaluators
- Custom evaluation builder
- Full dataset management
- Compliance and safety checks

### 📈 Monitoring & Analytics
- Cost and performance tracking
- Real-time debugging
- User analytics
- Custom business metrics

## LangWatch Cloud

Sign-up for a free account on [LangWatch Cloud](https://app.langwatch.ai) as the easiest way to get started.

- [📚 Learn how the platform works](https://docs.langwatch.ai/)
- [🚀 Start creating your optimization workflows](https://app.langwatch.ai/)
- [📈 Integrate Monitoring with Python or TypeScript](https://docs.langwatch.ai/integration/overview)

## Getting Started (local setup)

You need to have docker installed in your local environment to be able to run LangWatch locally.

Get started with:

```bash
git clone https://github.com/langwatch/langwatch.git
cp langwatch/.env.example langwatch/.env
docker compose up --build
```

Then, open LangWatch at http://localhost:3000

## Development

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

## On-Prem (Self-Hosting)

LangWatch also offers commercial support for self-hosting on your own infrastructure. For more information, please refer to the [Self-Hosting](https://docs.langwatch.ai/self-hosting) section of the documentation.

## Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please read our [Contribution Guidelines](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests.

## Support

If you have questions or need help, join our community:

- [Discord Community](https://discord.gg/kT4PhDS2gH)
- [Documentation](https://docs.langwatch.ai)
- [Email Support](mailto:support@langwatch.ai)