# ACME support agent, connected to LangWatch

A support agent for an outdoor gear shop, built on the OpenAI SDK and connected
to LangWatch Agent Testing with `langwatch.connect_agent`. When it runs, the
agent shows as Online in the project and every simulation turn reaches this
process.

The function declares two run parameters: `model` (`gpt-5-mini` or `gpt-5`)
and `plan` (`free` or `pro`). The system prompt changes with the plan, so the
agent answers a pro customer differently from a free one.

## Run

```bash
pip install -r requirements.txt
export LANGWATCH_API_KEY=sk-lw-...
export OPENAI_API_KEY=sk-...
python support_agent.py
```

`AGENT_NAME` changes the name the agent registers under. `APP_ENV` sets the
environment shown next to it (default `development`).
