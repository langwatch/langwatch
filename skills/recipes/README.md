# Recipes

Recipes are domain-specific, use-case-specific skills that solve particular problems. Unlike feature skills (tracing, evaluations, scenarios, prompts) which set up LangWatch platform features, recipes are "autoplayable cookbooks" -- actionable guides that an AI agent can execute.

## Available Recipes

| Recipe | Description |
|--------|-------------|
| `test-cli-usability` | Write scenario tests to ensure your CLI is usable by AI agents |
| `debug-instrumentation` | Debug and improve your LangWatch traces |
| `improve-setup` | Expert AI engineering consultant for your LangWatch setup |
| `evaluate-multimodal` | Evaluate multimodal agents (images, audio, PDFs) |
| `generate-rag-dataset` | Generate synthetic evaluation dataset from your RAG knowledge base |
| `test-compliance` | Test that your agent stays observational in regulated domains |

## Using a Recipe

Install a recipe skill:
```bash
npx skills-add langwatch/recipes/test-cli-usability
```

Or copy the prompt from the docs and paste it into your coding agent.

## Contributing

Create a new recipe by adding a folder under `skills/recipes/` with a `SKILL.md` following the AgentSkills standard.
