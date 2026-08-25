# Experiment

Experiment owns saved definitions, runs, and DSPy optimisation steps. API and
UI composition stay in the process applications.

- `contract`: Zod 4 values, commands, errors, and the canonical service.
- `server`: service implementation and private persistence.
- `web`: controlled batch-evaluation result data, comparison statistics, CSV
  export, and browser state hooks. App routing, transport hooks, feature flags,
  trace drawers, and table composition remain in `platform/app`.
- `adrs`: current architectural decisions.
- `specs`: behaviour that must remain stable during extraction.
