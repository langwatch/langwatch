# ACME checkout (Python, LangGraph)

The guest checkout agent of the ACME online store. A LangGraph graph takes the
guest from the cart to an order number: an assistant node talks to the guest
with OpenAI, and four step nodes do the work.

## What it does

- `POST /chat` with `{"messages": [{"role": "user", "content": "..."}], "thread_id": "..."}`
  gives back `{"output": "...", "thread_id": "...", "order_number": null}`.
  `order_number` is set once the order is placed.
- The state of a conversation lives in the graph's in-memory checkpointer,
  keyed by `thread_id`. A new thread takes the whole `messages` list, a known
  thread takes the last message only.
- Every guest arrives with the same cart: two Blue Mugs and one Desk Lamp,
  137.50 dollars plus 6.90 shipping.
- Two discount codes: `WELCOME10` takes 10 percent off, `SPRING25` expired on
  31 March 2026 and is refused.
- Payment is fake and deterministic: a card number of 12 to 19 digits is
  approved, one that ends in `0000` is declined. No money moves.
- The order number is derived from the thread id, so the same conversation
  always gets the same one.

## Files

```
app/store.py   the cart, the discount codes, the payment gateway and the order numbers
app/graph.py   the LangGraph graph: the assistant node, the four step nodes and the turn function
app/main.py    the FastAPI application
```

## Run it

```bash
cp .env.example .env      # set OPENAI_API_KEY
uv sync
uv run uvicorn app.main:app --reload --port 8767
```

From the repository root, `make dogfood-langy-local lang=langgraph` runs the
same command.

```bash
curl -s localhost:8767/chat -H 'content-type: application/json' \
  -d '{"thread_id":"demo","messages":[{"role":"user","content":"What is in my cart?"}]}'
```

## No tracing and no tests

The application sends no traces and has no tests, on purpose. Langy adds both
during the guided onboarding, so the first trace and the first scenario are
real.
