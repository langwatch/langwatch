# Experiment

Experiment owns saved definitions, runs, and DSPy optimisation steps. API and
UI composition stay in the process applications.

- `contract`: Zod 4 values, commands, errors, and the canonical service.
- `server`: service implementation and private persistence.
- `web`: controlled batch-result presentation, data transformation, comparison
  statistics, CSV export, and browser state hooks. App owns routes, tRPC,
  feature gates, page layout, trace drawers, and image rendering ports.
- `adrs`: current architectural decisions.
- `specs`: behaviour that must remain stable during extraction.
