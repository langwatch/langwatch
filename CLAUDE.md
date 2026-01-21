# LangWatch

LLM Ops platform for evaluation, observability, and optimization of AI agents and pipelines.

## Commands

```bash
make install          # Install all dependencies
make start            # Start dev server (after docker compose up redis postgres opensearch)
pnpm typecheck        # Type check (uses tsgo, fast)
pnpm test:unit        # Unit tests
pnpm test:integration # Integration tests
pnpm test:e2e         # E2E tests
```

## Structure

```
langwatch/           # Next.js app (main product)
langwatch_nlp/       # Python NLP service
langwatch_server/    # Python server
python-sdk/          # Python SDK
typescript-sdk/      # TypeScript SDK
specs/               # BDD feature specs
```

## Key References

- `TESTING.md` - test hierarchy, BDD workflow
- `docs/best_practices/` - coding conventions
- `docs/adr/` - Architecture Decision Records

## Common Mistakes to Avoid

| Mistake | Correct |
|---------|---------|
| `it("should...")` | `it("returns...")` - no "should" |
| `npm tsc` | `pnpm typecheck` (uses tsgo) |
| Code before tests | Outside-In TDD: spec → test → code |
| Tests after TODO list | BDD specs come first |
| Shared types in `types.ts` | Colocate unless truly shared |
| Duplicating Zod + TS types | Zod only, use `infer` |
