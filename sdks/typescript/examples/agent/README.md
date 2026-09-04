# A connected agent

`support-agent.ts` is a support agent built with the Vercel AI SDK and wrapped with `connectAgent` from `langwatch/agent`. When it runs, it connects to LangWatch, shows as Online in Agent Testing, and answers every simulation turn from this process. No public URL, no tunnel.

It declares its run parameters with a zod schema, which types `params` in the handler and validates the values a run supplies.

## Setup

```bash
npm install
export LANGWATCH_API_KEY=sk-lw-...
export OPENAI_API_KEY=sk-...
```

`LANGWATCH_API_KEY` is a personal or project API key. Set `LANGWATCH_PROJECT_ID` when the key reaches more than one project. Set `LANGWATCH_ENDPOINT` on a self-hosted instance. For a private certificate authority, point `NODE_EXTRA_CA_CERTS` at the CA bundle.

## Run

```bash
npx tsx support-agent.ts
```

The process stays up until Ctrl-C. Open Agent Testing in LangWatch: `support-agent` is online in the `development` environment, scoped to your key. Run a suite against it, or one turn from the CLI:

```bash
langwatch agent list
langwatch agent run <agent-id> --message "I want a refund" --param plan=pro
```

Set `APP_ENV=production` (or `LANGWATCH_AGENT_ENVIRONMENT`) to register a shared agent under another environment. Two processes with the same name and environment are one agent with two instances.

## Try it locally

The wrapped function is directly callable. Pass a question as the argument and it answers once, with the connection still open:

```bash
npx tsx support-agent.ts "How do I invite a teammate?"
```

## What the agent declares

- `model`: `z.enum(["gpt-5-mini", "gpt-5"])`, default `gpt-5-mini`
- `plan`: `z.string()`, default `free`

Both appear as run parameters in the run dialog. `z.enum` becomes a closed option list there, `.default()` the default, and `.describe()` the description beside the field. Give every property a default, or the run must supply a value for it. Keep the schema flat and scalar: nested objects and arrays are not run parameters.

valibot and arktype work the same way, and so does any other Standard Schema object that carries a JSON Schema converter. For a project with no schema library, `parameters` also takes a definition map (`{ model: { options: ["gpt-5-mini", "gpt-5"], default: "gpt-5-mini" } }`) or a plain JSON Schema object.

The function returns `{ output, session }`: `session` comes back on the next turn of the same conversation.
