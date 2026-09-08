# Wave-3 process wiring: topic, then sso and data-privacy

**Date:** 2026-09-08 · **Owner lane:** one Opus agent, after the wave-2 wiring lane leaves
`apps/api/src/app/api-production.composition.ts` · **Reviewed by:** Fable

Same rules as `wave2-process-wiring.md`: Read/Edit/Write only, no git writes, no baselines, no root
typecheck/lint/format, ONE `tsc --noEmit -p apps/api/tsconfig.test.json` (and one for
`apps/worker/tsconfig.test.json`) as oracle filtered to touched files, HEAD-variant blobs for files
carrying other lanes' hunks written to the blob directory Fable names in the launch prompt.

## topic (feature landed `a8508cf3c7`)

`TopicService` → `TopicApi` (type only, member list identical); `ComposedTopicFeature.service` → `.app`;
`composeTopicFeature`/`refusingTopicFeature` → `installApiTopic({ infrastructure })` (async);
`TopicInfrastructure` lost `database` (persistence is chosen at boot).

Type rename `TopicService` → `TopicApi`:
- `apps/api/src/app-trpc/app-trpc.context.ts` (import + `topics: TopicApi;`)
- `apps/api/src/app/api-trace-read-stack.composition.ts`
- `apps/api/src/features/trace/trace.composition.ts`
- `apps/api/src/features/organization/__tests__/tenant-features.composition.integration.test.ts`
- `apps/worker/src/app/worker-report-schedule.composition.ts` (`refuseReportRead<TopicApi>`)
- `packages/features/trace/server/src/services/trace-topic-naming.service.ts`
- `packages/features/trace/server/src/services/trace-list-read.service.ts`

`apps/api/src/index.ts`: export `installApiTopic` instead of `composeTopicFeature, refusingTopicFeature`.

`apps/api/src/app/api-production.composition.ts` (match on text, the file moves):
- import `installApiTopic`; `private composedTopic: ComposedTopicFeature | undefined;`
- `this.composedTopic = infrastructure ? await installApiTopic({ infrastructure }) : undefined;`
- tRPC-record block: `const topic = this.composedTopic;` beside `const share = ...`; add `|| !topic` to the
  refusing guard and `&& topic` to the `features` conjunction; `topic: this.composedTopic,` → `topic,`;
  `topics: this.composedTopic.service,` → `topics: topic.app,`.
- `composeTrace`: same local, guard gains `|| !topic`, both `this.composedTopic.service` → `topic.app`.
- organization/project block: same local, guard gains `|| !topic`, `topics: topic.app,`.

Test doubles: `apps/api/src/app/__tests__/api-trpc-record.test-doubles.ts` drops `refusingTopicFeature`,
adds `stubTopicFeature()` (`{ app: stub("topic"), router: (mount) => createTopicTrpcRouter(mount.runtime) }`
with `createTopicTrpcRouter` from `apps/api/src/features/topic/topic-trpc.mount.ts` and the type from
`topic.composition.types.ts`) and uses it; `apps/api/src/app-trpc/__tests__/support/app-trpc-features.ts` and
`apps/api/src/features/gateway/__tests__/gateway.composition.integration.test.ts` import the stub the same way
the share/presence stubs are imported.

Worker: `apps/worker/src/app/worker-tenancy.composition.ts` `.withFeature(topicServer, { infrastructure:
options.topics })` (no `database`); `Omit<TopicInfrastructure, "database">` in that file and
`worker-tenancy-infrastructure.composition.ts` becomes plain `TopicInfrastructure`.
**Prerequisite:** `apps/worker/src/app/worker-foundation-apps.composition.ts` builds
`createApp({ name: "langwatch-worker-foundation" }).withInfrastructure({})` with no persistence; boot refuses a
`withRepositories` feature there. Add `.withPersistence("postgres", { prisma: options.connection.client })`
(share already needs it). Same for the test builders in
`apps/worker/src/app/__tests__/worker-tenancy.composition.unit.test.ts` and
`apps/worker/src/__tests__/codex-coding-defaults.integration.test.ts`.

No change: `app-trpc/index.ts`, `app-trpc.composed.ts`, `app-trpc.features.ts` (`router` kept its signature).

Follow-ups outside this lane: `TopicClusteringSchedulePort.tryGetNextWakeAt` and the clustering repository's
`tryFindProject`/`tryFindTopicModelCursor`/`tryLoad` still trip `fallible-result-naming` (reach apps/worker
tests); `guardOutput` now always validates outputs where the old mount honoured `validateOutput`.

## sso — pending lane report

## data-privacy — pending lane report
