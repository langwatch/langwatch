# ADR-001: Worker composition boundary

**Status:** Accepted

`apps/worker` is a package-composed process root. `app` owns one executable
graph, `platform` owns configuration and infrastructure, and `features` only
mounts named feature-owned installers. It never imports `platform/app`.

The Topic installer is the first mounted feature contribution. The worker
installs Topic's pipeline, typed execution ports, boot seeds, and manual
Eventing command transport through the feature-owned installer rather than
platform/app. Manual invocation only requests the owning Topic process; it
never runs a clustering page directly.

## Migration state

`WorkerProductionComposition` owns the constructible Topic/Eventing producer
slice, but deliberately does **not** activate the shared
`event-sourcing/jobs` consumer. Eventing has one shared queue, and a
Topic-only registry would reject every other pipeline's job for retry. It also
does not mount the Trace `assignTopic` consumer, whose projections still live
in the complete Trace processing pipeline.

The physical `platform/app/src/workers.ts` executable therefore still selects
`createLegacyWorkerPorts()` and `startWorkers()`: it registers the complete
Eventing graph and owns unrelated worker jobs. The executable can switch only
when a package-composed full registry mounts Trace (including `assignTopic`)
and every other shared-queue pipeline, with its durable stores, Group Queue,
typed execution/configuration, observability, transport, and drain lifecycle.
