---
name: connect-agent
user-prompt: "Connect my agent to LangWatch simulations"
description: Connect the codebase's AI agent to LangWatch agent simulations, so test suites run against the real agent process. Adds a small connect function beside the service startup that calls the agent already in the codebase, which opens an outbound connection and registers the agent with its environment and its run parameters, confirms the agent is Online, and runs the first test suite. Falls back to an HTTP registration when the agent cannot import the SDK. Use when the user wants platform scenarios to test their real agent.
license: MIT
compatibility: Works with Claude Code and similar coding agents. The `langwatch` CLI is the only interface for platform operations.
---

# Connect Your Agent to LangWatch Simulations

Connect the agent in this codebase to LangWatch, so test suites run from the platform against the real agent process. The SDK opens an outbound connection to LangWatch from the process that already runs the agent, registers the agent with its environment and its run parameters, and receives one call per conversation turn. The simulation exercises the real code, dependencies, secrets and traces.

Three steps: install the SDK, add the connect function where the service starts, start the service the way the user always starts it. Work through them in order, confirm the agent reads Online, run one test suite, then report what changed and the result.

Use the HTTP fallback at the bottom of this skill ONLY when the agent cannot import the SDK: the agent is written in a language with no LangWatch SDK, or you have no access to its code.

## Step 1: Set up the LangWatch CLI

## Step 2: Install the SDK

Read the codebase first. Find two things: the entry point that runs the agent, which is what the connect function calls, and the file that starts the service, which is where the connect function goes.

```bash
pip install langwatch          # Python
npm install langwatch zod      # TypeScript, Node only
```

The process needs `LANGWATCH_API_KEY` in its environment. It is the same project key the CLI uses. Without a key the SDK logs one line and opens no connection.

## Step 3: Add the connect function where the service starts

Write a small function beside the code that starts the service. It is the adapter between the messages that come from a scenario test and the agent in the codebase.

Put it in the file that starts the service, or in a module that file imports at startup. The connection opens with the process, so the code has to run when the process runs.

**Python**

```python
# main.py, beside the server startup
import langwatch

from my_app.agent import SupportAgent

@langwatch.connect_agent(name="support-agent")
async def support_agent(
    messages: list[dict],
    thread_id: str,
    *,
    model: str = "gpt-5-mini",
) -> str:
    result = await SupportAgent(model=model).run(messages, conversation_id=thread_id)
    return result.output_text
```

**TypeScript**

```typescript
// server.ts, beside the server startup
import { z } from "zod";
import { connectAgent } from "langwatch/agent";

import { runSupportAgent } from "./agent";

connectAgent(
  {
    name: "support-agent",
    parameters: z.object({
      model: z.enum(["gpt-5", "gpt-5-mini"]).default("gpt-5-mini"),
    }),
  },
  async ({ messages, threadId, params }) => {
    const result = await runSupportAgent({
      messages,
      conversationId: threadId,
      model: params.model,
    });
    return result.text;
  },
);
```

Rules for the connect function:

- `name` is required. Use the name the team calls the agent, in lower case with dashes.
- Call the agent the product already runs. Do not reimplement it in the connect function, and do not call a simplified copy of it, or the suite tests code no customer reaches.
- Change nothing about how the service starts. The connect function runs on the startup path, and the start command stays the same.
- **Turn fields** are what the platform sends on every call: `messages` (the whole conversation, OpenAI-style), `new_messages` (`newMessages`, the delta since the last turn), `thread_id` (`threadId`), `session`, `trace_id` (`traceId`). In Python, declare only the ones you use and the SDK passes exactly those. In TypeScript, they arrive as one object, so destructure what you need.
- Return a string, one message, a list of messages, or `langwatch.AgentReply(output, session=...)` (`{ output, session }` in TypeScript).
- Do not change the agent's own code to fit the connect function. Map the turn onto the agent's existing call in the connect function instead.
- Do NOT add a `traceparent` middleware. The SDK adopts the turn's trace context before it calls the function, so the agent's spans land in the turn's trace and the judge reads them.

### Run parameters

A Python parameter that is not a turn field is a run parameter. The platform offers it in the run dialog and in `--param`. A parameter with a default is optional, and the run dialog prefills that default. A parameter with no default is required, and a run that does not supply a value for it is refused before the function is called.

```python
from typing import Literal

@langwatch.connect_agent(name="support-agent")
async def support_agent(
    messages: list[dict],
    *,
    model: Literal["gpt-5", "gpt-5-mini"] = "gpt-5-mini",
    plan: str = "free",
    max_tools: int = 5,
) -> str:
    ...
```

TypeScript declares them with a zod schema in `parameters`, the way Step 3 shows. Read the values out of `params` in the connect function and pass them into the agent's own call. The schema types `params` in the handler, and the SDK validates the values a run supplies against it. Add `zod` to the project (`npm install zod`) if it is not there yet. Read the schema this way:

- `z.enum([...])` becomes a closed option list in the run dialog. A value outside the list is refused.
- `.default(value)` sets the default.
- `.describe(text)` sets the description shown beside the field.
- `z.number()` and `z.boolean()` set the parameter type. `z.string()` is text.

Give every property a default, or the run must supply a value for it. Keep the schema flat and scalar: nested objects and arrays are not run parameters.

valibot and arktype work the same way, and so does any other Standard Schema object that has a JSON Schema converter. `parameters` also takes a definition map for a project with no schema library (`{ model: { options: ["gpt-5", "gpt-5-mini"], default: "gpt-5-mini" } }`), or a plain JSON Schema object.

Declare a parameter for a value the tests must vary: a model, a plan, a tenant, a fixture id. `Literal` and `Enum` in Python, and `z.enum` in TypeScript, become a closed list that the run dialog offers as choices and the platform refuses a value outside of.

### Session, when the agent mints its own conversation id

`thread_id` is the platform's conversation id. `session` is the agent's own memory of the conversation: any JSON value, `None` on the first turn, and whatever the function returns comes back on the next turn of the same conversation.

```python
@langwatch.connect_agent(name="support-agent")
async def support_agent(messages: list[dict], session: str | None = None):
    conversation_id = session or await my_agent.create_conversation()
    reply = await my_agent.send(conversation_id, messages[-1]["content"])
    return langwatch.AgentReply(reply, session=conversation_id)
```

The platform holds the value for the run, so this works with any number of production instances. An in-memory map keyed by `thread_id` works too, with `sticky=True` on the decorator to keep a conversation on one instance.

Use `session` when the agent's API creates its own conversation and cannot accept an id from outside. An agent that reads the whole `messages` list on every turn needs nothing here.

### Environment

The SDK reads the environment from the `environment` argument, then `LANGWATCH_AGENT_ENVIRONMENT`, then `APP_ENV`, `ENVIRONMENT` and `NODE_ENV`, and falls back to `development`. Each environment is a separate row on the agents page, so production and a developer machine are two targets that a comparison run puts side by side.

`development` makes the agent personal: only its owner can run it when the key is personal, and only that machine registers it when the key is a project key. Name the environment `dev-shared` for a development box the whole team runs against.

Leave `environment` out when the service already sets `LANGWATCH_AGENT_ENVIRONMENT`, `APP_ENV`, `ENVIRONMENT` or `NODE_ENV`. The SDK reads them on its own.

## Step 4: Start the service and confirm the agent is Online

Start the service the way the user starts it. Do not add a start command, and do not write a separate runner script: the connect function is already on the startup path, and a web server holds the connection open by itself.

The exception is an agent that is a library with no process of its own. Put the connect function in a small script and keep the script alive:

```python
langwatch.agent.serve()   # Python, at the bottom of the script
```

```typescript
// TypeScript: keep the script alive yourself. The WebSocket holds the event loop
// while connected, but the HTTP fallback and the reconnect wait do not.
setInterval(() => {}, 1 << 30);
// Run it with the project's TypeScript runner, for example `tsx agent.ts`
```

Then confirm from the CLI, in another terminal:

```bash
langwatch agent list
```

The row for the agent reads `Online` with the environment and the instance count. `Offline` means the process is not connected: check that `LANGWATCH_API_KEY` is set in the process environment, that the process is running, and that outbound WSS to the LangWatch endpoint is allowed. When the network refuses the WebSocket upgrade, the SDK falls back to HTTP long polling on its own; `LANGWATCH_AGENT_TRANSPORT=http` forces that transport from the start.

Then read back what the platform registered:

```bash
langwatch agent get <agent-id> --format json
```

The answer carries `environment`, `status`, `instances` (hostname, pid, SDK and version per process) and `parameters`: one entry per run parameter with `name`, `type`, `options` (the closed list from `Literal`, `Enum` or `z.enum`), `defaultValue` and `description`. Compare it with the signature. A parameter that is missing was read as a turn field; one with no default is still registered, as a required parameter every run has to supply. An option list that is missing means the annotation was not a `Literal`, an `Enum` or a `z.enum`. Fix the code and restart the process; the row updates on the next registration.

## Step 5: Run the first test suite

Create a test suite, create one scenario about behavior this agent really has, file it into the test suite, and run it:

```bash
langwatch test-suite create 'Smoke'

langwatch scenario create 'Order status question' \
  --situation "A customer asks about the status of a recent order" \
  --criteria "The agent looks up the order before answering,The agent gives a concrete delivery estimate" \
  --test-suite 'Smoke'

langwatch test-suite run 'Smoke' --target connected:support-agent@development --wait
```

- `--target connected:<name>@<environment>` names the agent by identity. `connected:<agent-id>` works the same way; `langwatch agent list --format json` prints both.
- Write the situation and the criteria from the agent's real behavior in this codebase, not from the example. Include at least one criterion about a tool call or a lookup, which the judge verifies against the agent's own traces.
- `--criteria` takes one comma-separated string, so a criterion cannot contain a comma. Rephrase instead.
- `--test-suite` files the scenario into a test suite that exists. Create the test suite first.
- Repeat `--target` to compare two environments, or the same agent with two parameter values: `--target 'connected:support-agent@production?model=gpt-5'`.
- `--wait` blocks until the run finishes and exits non-zero when it fails. Use it here: the report in Step 6 needs the result.
- Keep the agent process running for the whole run. A run against an agent with no connected instance is refused with `agent_offline`.

When the first run is green and the agent declares a parameter with an option list, offer one comparison run across the options. It reuses the same test suite, and the results page shows one column per value:

```bash
langwatch run-plan run --test-suite 'Smoke' \
  --target 'connected:support-agent@development?model=gpt-5' \
  --target 'connected:support-agent@development?model=gpt-5-mini' \
  --name 'Smoke: model comparison' --format json
```

`--param plan=pro` on the same command sets a value every target shares. The platform refuses a value outside the option list before anything is scheduled, and a name that neither the scenario nor the target agent declares is refused the same way, so read the names from `langwatch scenario get` and `langwatch agent get` rather than from memory.

## Step 6: Report the result

Report to the user:

- The Agent Testing page URL of their LangWatch project (`https://app.langwatch.ai/<project-slug>/agent-testing`, or the same path on their own instance when self-hosted).
- What changed in the codebase: the decorated function, the parameters it declares, the environment it registers under.
- The result of the first run.
- The parameters the platform registered, as `langwatch agent get` lists them, so the user knows which levers the run dialog offers. The `scenarios` skill reads the same list when it proposes scenarios; its prompt is "Add scenario tests for my agent".

Report failures as they happened. If a CLI command failed or the platform was unreachable, name the step that failed and what the failure means for the user, and stop there. Do not paste the raw error text, stack trace or debug URL: those can contain secrets and tell the user nothing they can act on. Do NOT claim a scenario or a test suite ran when it did not.

A connected setup shows, on the run page: the conversation transcript, a trace link on each turn opening the agent's own spans, and judge reasoning that cites spans.

## Plan Limits

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits. If 3 resources of the relevant type are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and note that upgrading the plan raises it. Point to the subscription settings on the platform, or to the license settings if the CLI is pointed at a self-hosted endpoint. Read the endpoint the CLI actually uses, which can come from `.env`, from the process environment, or from the saved CLI configuration.
- Do NOT delete existing resources to make room or repurpose an existing resource to evade the limit.

## Fallback: register an HTTP agent

Use this path ONLY when the decorator is impossible: the agent is written in a language with no LangWatch SDK, or the code is out of reach and only a URL is available. The platform then calls a public URL once per conversation turn, and the setup needs three extra pieces of work: a reachable endpoint, a body template, and a `traceparent` middleware.

### Locate the endpoint

Find the HTTP endpoint that takes a user message and returns the agent's reply. If none exists, add one: accept a JSON body carrying the conversation messages, run the agent, and return the reply text in a JSON field, for example `{"reply": "..."}`.

### Wire authentication for scenario traffic

Understand the endpoint's authentication before touching it.

- If the endpoint accepts a fixed token in a header, use that credential as-is in the registration. Change nothing on the server.
- If the normal authentication is built for human users (sessions, cookies, OAuth redirects), add a dedicated authentication path for scenario traffic: the server reads the expected key from an environment variable such as `SCENARIO_API_KEY` and checks it against the `Authorization: Bearer` header on each request. A request carrying the valid key is accepted; every other request goes through the existing authentication unchanged. If `SCENARIO_API_KEY` is unset, the path is off.

NEVER weaken, bypass, or remove the existing authentication for normal traffic. The scenario path is additive, and the dedicated key is what the user revokes to close it.

Store the key as a project secret so the registration references it instead of holding it:

```bash
langwatch secret create SCENARIO_API_KEY --value "<key>"
```

### Adopt the trace context

This step belongs to the HTTP path only. The platform sends a W3C `traceparent` header on every call, one trace per conversation turn. When the server adopts it, the spans the agent produces land in that same trace, and the judge reads them before its verdict. Without it the judge can only grade the reply text, and criteria about tool calls or lookups come back inconclusive.

- If the service uses OpenTelemetry HTTP auto-instrumentation, adoption already happens. Verify it in the code and change nothing.
- Otherwise, attach the extracted context in a middleware that runs before any tracing starts. Do not extract inside the handler body: a handler decorated with `@langwatch.trace()` opens its root span before the body runs, so an extraction there is too late and the agent's spans land in a separate trace. The middleware placement covers every tracing style: decorators, `with langwatch.trace()`, autotrack, community instrumentations, and plain OpenTelemetry spans.

**Python (ASGI middleware, e.g. FastAPI):**

```python
from opentelemetry import propagate
from opentelemetry.context import attach, detach

@app.middleware("http")
async def adopt_remote_trace(request, call_next):
    token = attach(propagate.extract(dict(request.headers)))
    try:
        return await call_next(request)
    finally:
        detach(token)
```

For Flask, attach in `before_request` (keep the token on `g`) and detach in `teardown_request`.

**TypeScript (middleware, registered before the routes):**

```typescript
import { context, propagation } from "@opentelemetry/api";

app.use((req, res, next) => {
  const ctx = propagation.extract(context.active(), req.headers);
  context.with(ctx, () => next());
});
```

The TypeScript middleware needs an initialized OpenTelemetry runtime: a registered context manager and propagator. The LangWatch SDK's `setupObservability()` and the OpenTelemetry `NodeSDK` both register them at startup; without one of them, `context.with` and `propagation.extract` are no-ops.

Confirm the agent reports its traces to the same LangWatch project that runs the scenarios (the same `LANGWATCH_API_KEY` project). Traces sent to another project, or to another observability backend only, are invisible to the judge. If the service has no LangWatch tracing yet, set it up with the `tracing` skill; its prompt is "Instrument my code with LangWatch".

### ASK where the agent runs

Ask the user for the URL where this service is deployed, and wait for the answer. A staging deployment is the recommended target: it exercises the real system without touching production data. Any URL the LangWatch backend can reach works; an internal hostname or a firewalled service does not.

If the agent only runs on the user's machine, register it as below and then run `langwatch agent dev --port <port> --agent <agent-id>`, which opens a tunnel to the local port and points the registered agent at it for the session. Keep it running while test suites execute; Ctrl-C restores the previous URL.

### Register and run

Adjust `bodyTemplate` to the request shape the endpoint expects and `outputPath` to the JSONPath of the reply text in the endpoint's real response:

```bash
langwatch agent create 'My Agent' --type http --config '{
  "url": "https://staging.example.com/chat",
  "bodyTemplate": "{\"thread_id\": \"{{ threadId }}\", \"messages\": {{ messages }}}",
  "outputPath": "$.reply",
  "auth": {"type": "bearer", "token": "{{ secrets.SCENARIO_API_KEY }}"}
}'
```

If the endpoint creates its own conversation and returns its id, add `"sessionPath": "$.conversation_id"` (the JSONPath of that value in the response) and read it back as `{{ session }}` in the body template, the URL or a header on the next turn of the same conversation. It is empty on the first turn.

The body template renders as a Liquid template on every turn. The URL and header values render the same variables:

| Variable                             | Value                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `{{ messages }}`                     | The whole conversation as a raw JSON array of `{role, content}` messages                                                      |
| `{{ input }}`                        | The text of the last user message                                                                                             |
| `{{ threadId }}`                     | A conversation id, the same on every turn of a run                                                                            |
| `{{ params.NAME }}`                  | A run parameter the scenario declares                                                                                         |
| `{{ traceId }}`, `{{ traceparent }}` | The turn's trace identifiers, for systems that read them from the body or a custom header instead of the `traceparent` header |

Run it with `--target http:<agent-id>`, and follow Step 5 and Step 6 otherwise unchanged.

## Common Failures

| Symptom                                                                                                  | Cause                                                                                                                                                             | Fix                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `langwatch agent list` shows no row for the agent                                                        | The process started without an API key, so the SDK opened no connection.                                                                                          | Set `LANGWATCH_API_KEY` in the process environment and restart the process.                                                                                                                 |
| The row reads `Offline`                                                                                  | The process stopped, or its outbound connection is blocked.                                                                                                       | Restart the process. On a network that blocks WebSockets, set `LANGWATCH_AGENT_TRANSPORT=http`; the SDK then registers over HTTP long polling.                                              |
| The process logs `timed out during opening handshake` on every attempt while `curl` reaches the endpoint | The host resolves the endpoint to an IPv6 address it cannot reach, most often behind a VPN tunnel that drops IPv6, and an older SDK waited on that address alone. | Update the `langwatch` package to the latest release: it moves on to the next address after 0.25 s (`LANGWATCH_AGENT_HAPPY_EYEBALLS_DELAY` tunes it). Disconnecting the VPN also clears it. |
| `langwatch agent get` lists a parameter without `options`, or does not list it at all                    | The annotation is not a `Literal`, an `Enum` or a `z.enum`, or the parameter has no default and the platform reads it as required.                                | Change the annotation or add the default, then restart the process.                                                                                                                         |
| The run is refused with `agent_offline`                                                                  | No instance was connected when the run started.                                                                                                                   | Start the agent process and run again.                                                                                                                                                      |
| The run is refused with `agent_owner_only`                                                               | The agent registered under `development` with a personal key, so only its owner can run it.                                                                       | Run it as the owner, or register it under a shared environment name such as `dev-shared`.                                                                                                   |
| The run is refused with `scenario_parameter_option_invalid`                                              | A value is outside the closed option list the agent declares.                                                                                                     | Use one of the listed options, or widen the `Literal` (Python) or `z.enum` (TypeScript) list in the code.                                                                                   |
| A turn fails with `agent_call_timeout`                                                                   | The call took longer than the agent's timeout.                                                                                                                    | Raise `timeout` on the connect function (up to 300 seconds), or make the agent answer faster.                                                                                               |
| Trace-dependent criteria come back inconclusive                                                          | The agent reports its traces to a different LangWatch project, or it reports none at all.                                                                         | Point the agent's tracing at the same project's API key. Set it up with the `tracing` skill.                                                                                                |

## Common Mistakes

- Do NOT reimplement the agent inside the connect function, and do NOT point it at a simplified copy. It calls the agent the product already runs, so the simulation exercises the real code path.
- Do NOT add a runner script or a second start command when the service already has one. The connect function goes on the existing startup path.
- Do NOT add a `traceparent` middleware for a connected agent. The SDK adopts the trace context itself; the middleware belongs to the HTTP fallback only.
- Do NOT hardcode an environment string, and do NOT write a fallback such as `process.env.APP_ENV ?? "development"`. It overrides `LANGWATCH_AGENT_ENVIRONMENT` and registers a production process under `development`. Let the SDK resolve the environment.
- Do NOT declare a run parameter for a value the tests never vary. Every declared parameter appears in the run dialog.
- Do NOT use a turn field name (`messages`, `new_messages`, `thread_id`, `session`, `trace_id`) as a run parameter name.
- Do NOT invent an agent id or pass a URL as the run target. Read the identity from `langwatch agent list --format json`.
- Do NOT pass `--test-suite` a test suite the project does not hold. The command refuses it; create the test suite first with `langwatch test-suite create`.
- Do NOT stop the agent process while a run is executing. Every turn of the run calls it.
- Do NOT reach for the HTTP fallback because the decorator looks like more work. It is fewer steps: no public URL, no body template, no credential in the agent configuration, no middleware.
- Do NOT report success when a command failed. An unreachable platform or a failed run is part of the report, named per step.
