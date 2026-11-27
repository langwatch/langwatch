# Recipes

Recipes are domain-specific, use-case-specific skills that solve particular problems. Unlike feature skills (tracing, evaluations, scenarios, prompts) which set up LangWatch platform features, recipes are "autoplayable cookbooks" -- actionable guides that an AI agent can execute.

## Available Recipes

| Recipe                  | Description                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `test-cli-usability`    | Write scenario tests to ensure your CLI is usable by AI agents                        |
| `debug-instrumentation` | Debug and improve your LangWatch traces                                               |
| `agent-best-practices`  | Expert AI engineering consultant for your agent development practices                 |
| `debug-with-langwatch`  | Root-cause production errors: errored traces → spans → monitor/evaluator scores       |
| `eval-triage`           | Investigate failing experiments and evaluation regressions                            |
| `setup-lw`              | Set up and troubleshoot the LangWatch CLI (login, endpoint, project)                  |
| `evaluate-multimodal`   | Evaluate multimodal agents (images, audio, PDFs)                                      |
| `generate-rag-dataset`  | Generate synthetic evaluation dataset from your RAG knowledge base                    |
| `test-compliance`       | Test that your agent stays observational in regulated domains                         |
| `find-traces`           | Find the traces that match a question in the Trace Explorer                           |
| `lwql-charts`           | Build a saved analytics chart from a plain question and put it on a dashboard         |
| `dashboard-widgets`     | Build a custom dashboard widget backed by LangWatchQL queries                         |
| `owasp-red-team`        | Red team your agent in code against the OWASP Top 10 for LLM and agentic applications |

## Using a Recipe

Install a recipe skill:

```bash
npx skills-add langwatch/recipes/test-cli-usability
```

Or copy the prompt from the docs and paste it into your coding agent.

## Contributing

Create a new recipe by adding a folder under `skills/recipes/` with a `SKILL.mdx` following the AgentSkills standard. Files the recipe hands to a coding agent, such as test templates, go in a `templates/` folder beside it and ship with it (see `skills/README.md`).
