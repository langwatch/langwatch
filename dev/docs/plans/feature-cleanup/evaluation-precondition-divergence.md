# Two implementations of monitor preconditions, and they know different fields

Found while reducing `evaluation-precondition.service.ts` below its complexity
ceiling. Recorded rather than fixed: closing it is a feature change, not a
cleanup.

## The two

| | file | fields | reached from |
| --- | --- | ---: | --- |
| preview | `platform/app/src/server/filters/precondition-matchers.ts` (273 lines) | 30 | `traces.api.ts:494`, the monitor **sample preview** |
| execution | `packages/features/evaluation/server/src/services/evaluation-precondition.service.ts` (210) | 17 | `evaluation-execution-preparation.service.ts:102`, the monitor **running** |

The preview is injected as a port at `platform/app/src/server/api/root.ts:653`
and answers "which traces would this monitor match" while a person is
configuring it. The execution path decides whether the monitor actually fires.

## The thirteen the execution path does not know

    evaluations.evaluator_id                    traces.name
    evaluations.evaluator_id.guardrails_only    metadata.key
    evaluations.evaluator_id.has_label          events.metrics.value
    evaluations.evaluator_id.has_passed
    evaluations.evaluator_id.has_score
    evaluations.label
    evaluations.passed
    evaluations.score
    evaluations.state

An unknown field resolves to `null`, and `matches` reads `null` as not-met for
every rule except `not_contains`. So a precondition on any of these:

- shows matching traces in the sample preview,
- and then never fires once the monitor is live.

Pinned by `evaluation-precondition.service.unit.test.ts`, which asserts the
seventeen and asserts that `evaluations.passed` and `traces.name` come back
unmet.

## Why it is not a swap

The nine `evaluations.*` fields read a trace's EVALUATION RESULTS.
`PreconditionTraceData` on the execution side carries no such thing, and the
execute-evaluation command that builds it does not load them — so closing the
gap means deciding whether a monitor may gate on other monitors' results, and
loading them on the execution path if so. `traces.name`, `metadata.key` and
`events.metrics.value` are smaller and probably just missing.

Either way the durable fix is one implementation, not two. The preview is a
`legacy-feature-fragment` — the feature package holds the extracted version and
`platform/app` still holds the original, both live on different paths, which is
what that policy's 465 entries are about.
