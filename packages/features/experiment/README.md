# Experiment

Experiment owns saved experiment definitions and their archive lifecycle. Run
execution and projections belong to the server package; API and UI composition
stay in the process applications.

- `contract`: Zod 4 values, commands, errors, and the canonical service.
- `server`: service implementation and private persistence.
- `adrs`: current architectural decisions.
- `specs`: behaviour that must remain stable during extraction.
