# ACME support (Python)

The support agent of the ACME online shop. It answers one chat turn with
OpenAI and two tools, `lookup_order` and `refund_order`, over an in-memory
account store.

## What it does

- `POST /chat` with `{"messages": [{"role": "user", "content": "..."}]}` gives
  back `{"output": "...", "account_id": "..."}`.
- Two accounts: `acme-free` (plan free, orders A-1001 and A-1002) and
  `acme-pro` (plan pro, orders A-2001 and A-2002).
- A refund above 50 dollars needs the pro plan. On the free plan the tool
  refuses, and the agent explains the limit and offers to escalate the request
  to a human support agent.
- `acme_support` in `app/agent.py` carries `@langwatch.connect_agent`, so the
  running process also answers simulations from LangWatch Agent Testing. It
  declares one run parameter, `model`.

The application works on one account, `ACCOUNT_ID` in `app/agent.py`.

## Files

```
app/accounts.py   the account and order store, and the refund rule
app/agent.py      the LLM turn, the two tools, and the connected agent
app/main.py       the FastAPI application
tests/            the scenario tests
```

## Run it

```bash
cp .env.example .env      # set OPENAI_API_KEY, and LANGWATCH_API_KEY to connect
uv sync
uv run uvicorn app.main:app --reload --port 8765
```

From the repository root, `make dogfood-langy-local lang=python` runs the same
command.

```bash
curl -s localhost:8765/chat -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Refund 80 dollars on order A-2001"}]}'
```

Without `LANGWATCH_API_KEY` the application still serves `/chat`; it only
skips the connection to the platform. `LANGWATCH_AGENT_CONNECT=0` turns the
connection off with a key present.

## Test it

```bash
uv run pytest -s
```

Two scenarios run against the agent in the same process: a refund on the pro
plan goes through, and a refund of 80 dollars on the free plan is refused with
an offer to escalate. They need `OPENAI_API_KEY`, and they report to LangWatch
only when `LANGWATCH_API_KEY` is set.

## No tracing yet

The application sends no traces. There is no `langwatch.setup()` and no
`autotrack_openai_calls`. `app/agent.py` is where both belong: it builds the
OpenAI client, and it holds the turn the platform calls.
