# ADR-001: Experiment owns saved experiments

**Status:** Accepted

**Behavioural contract:** [Experiment service](../specs/experiment-service.feature)

## Decision

Experiment owns saved experiment identity, naming, slug allocation, workbench
state, workflow linkage, and archive state. Its contract exports Zod 4 values
and one `ExperimentService`; Prisma stays in the private server repository.

Experiment does not own Workflow or Monitor persistence. `ExperimentService`
fences only the Experiment row. The existing archive transport composes the
Workflow and Monitor services after that fence; a later durable command may
replace the transport orchestration without changing Experiment persistence.

Experiment runs, durable run commands, and DSPy optimisation steps use the
same service. Their ClickHouse repositories remain private. Existing REST and
tRPC names remain compatibility transports over the process-owned App service.

## Consequences

No request constructs an Experiment service or repository. No Experiment
repository writes another feature's table, and the package has no dependency
cycle through Workflow and Dataset. Slug conflicts are retried by the service,
archived rows cannot be mutated through an upsert, and there is no separate
DSPy service graph.
