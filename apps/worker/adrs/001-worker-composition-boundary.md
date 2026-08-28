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

On shutdown, the worker drains and closes its Eventing runtime before releasing
feature handles, worker transports, process infrastructure, or observability.
That order is required before consumer activation: queued handlers retain their
stores and diagnostics throughout the drain, while observability remains last.

The physical `platform/app/src/workers.ts` executable therefore still selects
`createLegacyWorkerPorts()` and `startWorkers()`: it registers the complete
Eventing graph and owns unrelated worker jobs. The executable can switch only
when a package-composed full registry mounts Trace (including `assignTopic`)
and every other shared-queue pipeline, with its durable stores, Group Queue,
typed execution/configuration, observability, transport, and drain lifecycle.

`WorkerStoredObjectStorageRuntimeFactory` is an injectable production
composition boundary for Group Queue storage, not a live cutover. It receives
typed storage selection, a current-project BYOC source, and a lazy Azure
factory from the physical host; its S3 driver borrows the Worker process AWS
runtime. Final activation remains blocked on that complete registry and its
physical launcher supplying those ports, so this boundary must not enable
consumers or replace the legacy executable yet.
