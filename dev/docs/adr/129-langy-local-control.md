# ADR-129: Langy works on the developer's code through a shared local folder

**Date:** 2026-09-02

**Status:** Accepted

## Context

Langy can change a customer's code in one way: through the organization GitHub App (ADR on `specs/langy/langy-github-prs.feature`). The worker clones the repository into its sandbox, commits as the bot and opens a pull request. That path is correct for a team that reviews every change, and slow for a developer who sits at the machine where the code already is: the sandbox has no local toolchain, no `.env`, no running server, and every check waits for CI.

The skills that lead to code changes (`tracing`, `connect-agent`, `scenarios`, `prompts`) end with instructions for the user to apply by hand. Langy never offers to do the change, and never asks how it should reach the code.

A cloud agent that runs commands on the developer's own machine is an established pattern. Claude Code Remote Control, Cursor self-hosted machines and VS Code Remote Tunnels all open an outbound connection from the machine and let the remote side run commands there, with a local permission layer. Opik ships `opik connect`, a bridge daemon that long-polls its backend and executes file and shell commands in the repository. Its bug history shows the failure modes to design out: a regex blocklist that missed `rm -rf .`, sub-second polling throttled by corporate proxies, Ctrl-C that left the UI green until a heartbeat expired, orphan processes, and a name that changed twice.

The platform already has the building blocks. Connected agents (ADR-128) open an outbound WebSocket to the app, register with presence in Redis, receive calls dispatched through Redis so any pod can serve the socket, and fall back to long-poll routes. The Langy worker reaches the app directly with its per-conversation session key. The ui-actions channel (`langwatch ui call`) already blocks a worker tool while the app relays a request to the browser and back. The choices card (ADR-060) already renders a question and records the answer as an event.

## Decision

We will ship **local control**: `langwatch langy --share-control` shares the current folder with one Langy conversation, and Langy gets tools that read, edit and run commands in that folder on the developer's machine.

### Code access is a question Langy asks once

Langy calls a `code_access` tool before the first change to the customer's program. When the conversation already has a folder connected, or the user remembered GitHub, the tool answers at once. Otherwise it renders the **code access card** with two options, share the local folder or use GitHub, and ends the turn. GitHub keeps the existing flow. A remembered GitHub choice is stored on the user, shown as a status card on later turns with a Change action, and can be cleared in the integrations settings. Platform-only work never asks.

### The CLI is the trust boundary

`langwatch langy --share-control` runs on the device session. The code access card records a control request bound to the conversation, the user and the project, valid for fifteen minutes. The CLI lists the open requests of the signed-in user and asks for approval in the terminal. Approval mints a Langy session key for that conversation through the existing session key service, and the CLI connects with it. No pairing code, no new token kind, no unauthenticated route.

The CLI holds the folder root, the read-only allowlist, the session grants and the skip-permissions state. Read-only commands and file edits inside the folder run without a prompt. Every other command blocks until the user answers a permission card in the chat: allow once, allow this pattern for the session, or deny. Paths outside the folder, `sudo` and secret files are refused with a pushback the model can act on. The read-only set is fixed and decided by parsing, never by the model. A pattern grant follows Claude Code: the command name plus its first argument, or the command name with a wildcard.

Skip permissions is one explicit user action per conversation. The server gates it on the model that runs the conversation: each provider carries a list of model patterns allowed to skip, with defaults only for OpenAI and Anthropic frontier models. The CLI records the consent, prints it, and keeps the path guard on.

### One user wait for permissions and questions

The worker gets a `question` tool as well. Both the permission card and the question card use the same server primitive, the **user wait**: the worker tool posts the ask to the app, the app writes a durable conversation event and a live stream entry, the panel renders the card while the turn is in flight, the user answers through tRPC, and the tool returns the answer. The turn keeps its plan. A wait past its budget returns a "no answer yet" result so Langy ends the turn in words; a later answer to a question travels as the next user message, which the choices card already supports. A late permission answer is expired.

### Transport is the connected-agents relay

The CLI opens an outbound WebSocket to `/api/v1/langy/control/connect`, with the three long-poll routes as the fallback. The worker starts a call with one HTTP request and long-polls the result with a twenty second hold. Call envelopes, results and approval state live in Redis so the worker's request and the CLI's socket can land on different pods. Presence is one workspace per conversation with a thirty second TTL. Connection is per conversation; Ctrl-C sends an explicit deregister.

The register frame carries an environment checklist: root, git branch and remote, dirty state, operating system, node and python versions, `gh` authentication state and package manager. Command output is returned when the command ends, capped at 64 KiB with the log path for the rest. Background commands return the process id and a log path under the folder's `.langwatch` directory.

### Names

The new command is `langwatch langy` with the flag `--share-control`. A bare `langwatch langy` does the same today; the flag keeps its meaning when a bare `langwatch langy` becomes a terminal chat with Langy. The tunnel of ADR-098 is documented as `langwatch agent tunnel`; `agent dev` stays as a hidden alias.

## Rationale / Trade-offs

Commands run on the developer's machine and not in the sandbox because the point is the developer's toolchain: `git`, `gh`, the package manager, the running server and the checks the project already has. A file sync would still leave all of that in the sandbox. Explicit `local_*` tools, instead of a transparent remount of the built-in tools, keep the model aware of where a call runs and let the card name the machine.

The CLI decides what runs because the machine is the customer's. The server relays a human answer and can gate one escalation, and nothing else the server does can widen what the CLI allows. An allowlist with a prompt was chosen over a blocklist because every blocklist in the precedent set was bypassed within months.

Login instead of a pairing code costs a browser login on first use and removes a token kind, an unauthenticated route and a copy step from the card. The approval in the terminal is the consent, on the machine that grants it.

A mid-turn wait instead of ending the turn keeps the model's plan and its context, which is what a permission prompt needs. The wait budget and the late-answer path keep a card from dying when the user walks away.

## Consequences

The tracing, connect-agent, scenarios and prompts skills change from instructions to offers. Langy asks how to reach the code once per conversation and then works in a branch of the developer's own checkout, runs the project's checks, commits, pushes and opens the pull request with the developer's own `gh` when it is authenticated.

The app gains one WebSocket path, three long-poll routes, a Redis key family, six conversation events, two cards and one chip. The worker gains the `code_access`, `question` and `local_*` tools. `User` gains a code access preference column and `ModelProvider` gains the skip-permissions model list. Self-hosted deployments need the WebSocket upgrade on `/api/v1/langy/control/connect` and a read timeout above the long-poll hold, the same requirement ADR-128 added.

Live command output does not stream into the panel in this version, because the pi harness drops `tool_update`. A terminal answer to a permission card is not in this version either; the terminal points at the panel.

## References

- Related ADRs: ADR-060 (model-emitted blocks and the choices card), ADR-078 (user turn controls), ADR-098 (`agent tunnel`), ADR-128 (connected agents)
- Specs: `specs/langy/langy-code-access.feature`, `specs/langy/langy-local-control.feature`, `specs/langy/langy-local-permissions.feature`, `specs/langy/langy-choice-questions.feature`, `specs/typescript-sdk/cli-langy-share-control.feature`, `specs/settings/model-provider-skip-permissions.feature`
- Precedent: Claude Code Remote Control and permission modes, Cursor self-hosted machines, VS Code Remote Tunnels, Opik `opik connect`
