# ACME checkout demo application

The guest checkout agent of the ACME online store, built with LangGraph and
FastAPI. It stands for the customer application in the guided onboarding: Langy
reads it, detects LangGraph, adds tracing, connects it to Agent Testing and
writes its first scenario.

- [`python/`](python/README.md): LangGraph, FastAPI, OpenAI, `uv`, port 8767.

Boot it from the repository root:

```bash
make dogfood-langy-local lang=langgraph
```

The application sends no traces and has no tests, on purpose. Langy adds both
during the guided onboarding, so the first trace and the first scenario are
real.
