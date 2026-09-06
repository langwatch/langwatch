# ACME support demo applications

Two small support agents with the same behaviour, one in Python and one in
TypeScript. They stand for the customer application in the Langy dogfood: a
coding agent reads them, changes them, and the scenario tests say whether the
change holds.

- [`python/`](python/README.md): FastAPI, OpenAI, `uv`, port 8765.
- [`typescript/`](typescript/README.md): Hono, Vercel AI SDK, `npm`, port 8766.

Boot one from the repository root:

```bash
make dogfood-langy-local lang=python
make dogfood-langy-local lang=typescript
```

Both applications connect to LangWatch Agent Testing and send no traces. The
tracing is the change a coding agent makes.
