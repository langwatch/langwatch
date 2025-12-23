# Event Sourcing Span Stress Test

Stress test the event sourcing pipeline by generating a large number of spans and ingesting them into the database.

## Development

```bash
pnpm --filter @langwatch/stressed-n-blessed typecheck
pnpm --filter @langwatch/stressed-n-blessed test
pnpm --filter @langwatch/stressed-n-blessed build
```


