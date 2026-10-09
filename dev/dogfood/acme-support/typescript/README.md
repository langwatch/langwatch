# ACME support (TypeScript)

The support agent of the ACME online shop. It answers one chat turn with the
Vercel AI SDK and two tools, `lookupOrder` and `refundOrder`, over an in-memory
account store.

## What it does

- `POST /chat` with `{"messages": [{"role": "user", "content": "..."}]}` gives
  back `{"output": "...", "accountId": "..."}`.
- Two accounts: `acme-free` (plan free, orders A-1001 and A-1002) and
  `acme-pro` (plan pro, orders A-2001 and A-2002).
- A refund above 50 dollars needs the pro plan. On the free plan the tool
  refuses, and the agent explains the limit and offers to escalate the request
  to a human support agent.
- `src/server.ts` wraps the turn in `connectAgent`, so the running process also
  answers simulations from LangWatch Agent Testing. It declares one run
  parameter, `model`.

The application works on one account, `ACCOUNT_ID` in `src/agent.ts`.

## Files

```
src/accounts.ts   the account and order store, and the refund rule
src/agent.ts      the LLM turn and the two tools
src/server.ts     the Hono application and the connected agent
tests/            the scenario tests
```

## Run it

```bash
cp .env.example .env      # set OPENAI_API_KEY, and LANGWATCH_API_KEY to connect
npm install
npm run dev
```

Install with `npm`, not with `pnpm`. The application is not a member of the
repository workspace, and it depends on the TypeScript SDK of this checkout
through `file:../../../../sdks/typescript`, which npm links in place.

From the repository root, `make dogfood-langy-local lang=typescript` runs the
same command.

```bash
curl -s localhost:8766/chat -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Refund 80 dollars on order A-2001"}]}'
```

Without `LANGWATCH_API_KEY` the application still serves `/chat`; it only
skips the connection to the platform. `LANGWATCH_AGENT_CONNECT=0` turns the
connection off with a key present.

## Test it

```bash
npm test
```

Two scenarios run against the agent in the same process: a refund on the pro
plan goes through, and a refund of 80 dollars on the free plan is refused with
an offer to escalate. They need `OPENAI_API_KEY`, and they report to LangWatch
only when `LANGWATCH_API_KEY` is set.

## No tracing yet

The application sends no traces. There is no `setupObservability` call.
`src/agent.ts` is where it belongs: it builds the model client and runs the
turn the platform calls.
