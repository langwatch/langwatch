# Vercel AI SDK

The app is on **AI SDK 7**. One version governs the whole workspace: the `ai`
override in `pnpm-workspace.yaml` at the repo root. Provider packages
(`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, …) are declared per
package and must stay on their v7-line majors — provider 4.x, `openai-compatible`
3.x, `react` 4.x. A provider from the wrong major installs cleanly and then
fails at the model boundary.

Bumping any of them goes through the release-age gate; see
[dependency-age-gates.md](dependency-age-gates.md).

## The v7 traps are invisible to the compiler

This is the part worth internalising. v7 kept a deprecated alias for nearly
everything it renamed, so `pnpm typecheck` passes on code that is broken at
runtime. When the migration landed, every call site typechecked clean and three
of them threw on the first request. Do not treat a green typecheck as evidence
that AI SDK code works.

| Change | Compiler | What actually happens |
|---|---|---|
| `role: "system"` inside `messages` | silent | throws `InvalidPromptError` on every call |
| telemetry without `registerTelemetry` | silent | zero spans emitted, forever |
| span scope `ai` → `gen_ai` | silent | scope-matching filters drop every span |
| top-level `usage` now spans all steps | silent | numbers grow; no error |
| `system:`, `stepCountIs`, `experimental_telemetry` | silent | still work (deprecated aliases) |

## Never put a system message in `messages`

v7 rejects a `role: "system"` entry inside `messages` or `prompt`. v6 only
warned. Pass the system prompt as top-level `instructions`:

```ts
// wrong — throws InvalidPromptError
await generateText({
  model,
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: question },
  ],
});

// right
await generateText({
  model,
  instructions: systemPrompt,
  messages: [{ role: "user", content: question }],
});
```

`allowSystemInMessages: true` switches the check off. It is a real escape hatch,
not a shortcut, and it is correct in exactly one situation: **the transcript
legitimately carries system turns you did not author and must not move.** Two in
this repo qualify — `playground.ts`, where an authenticated user is deliberately
authoring and testing their own system turns, and the scenario prompt-config
adapter, where a scenario author may have scripted one. Both say so in a comment.

Where `messages` is unvalidated client input and the system turn would be
injected rather than authored, leave the check on. Rejecting it is the point:
that is prompt-injection defence, which is why v7 made it the default.

**Watch for index arithmetic when you hoist.** Removing the leading system
message shifts every subsequent index by one. In the scenario judge, a
`.slice(2)` existed to drop `[system, criteria]`; after hoisting it had to become
`.slice(1)` or it ate the first real message. Grep the surrounding function for
`slice`, `[0]`, `[1]` and length assertions before you call it done.

## Telemetry does not exist until you register it

In v6, OpenTelemetry was built into `ai` and `experimental_telemetry:
{ isEnabled: true }` was enough. In v7 it lives in a separate package and emits
**nothing** until an integration is registered. There is no warning.

```
v6:  generateText ──► ai's built-in OTel ──► global TracerProvider ──► exporter
                       (per-call flag)

v7:  generateText ──► ??? ──► nothing                    ← no registration
     generateText ──► @ai-sdk/otel ──► global TracerProvider ──► exporter
                       ▲
                       └── registerTelemetry(new OpenTelemetry())  ← required, once
```

```ts
import { registerTelemetry } from "ai";
import { OpenTelemetry } from "@ai-sdk/otel";

setupObservability({ serviceName: "..." });
registerTelemetry(new OpenTelemetry()); // once, at startup
```

Once registered, telemetry is **opt-out** — you no longer set a flag per call.

Two consequences that are easy to miss:

- **The instrumentation scope changed from `ai` to `gen_ai`.** Anything matching
  on scope name must accept both. This is why `isVercelAiSpan` in the TypeScript
  SDK (`sdks/typescript/src/observability-sdk/exporters/trace-filters.ts`) checks
  for either; matching only `ai` silently discarded every span from a v7 app.
- **Span names changed too** — `chat <model>`, `step N`, `invoke_agent <model>`,
  where v6 emitted `ai.generateText` and `ai.generateText.doGenerate`. Do not
  write logic that matches v6 span names.

Anything we ship that tells a customer how to send us AI SDK traces — docs, SDK
examples, the onboarding snippet in
`src/features/onboarding/regions/observability/codegen/snippets/` — must include
the `registerTelemetry` call and list `@ai-sdk/otel` in its install command.
Without it the customer sees no data and concludes LangWatch is broken.

## Always resolve models through the provider layer

Never construct a provider inline in a route or service. Go through
`getVercelAIModel({ projectId, model?, featureKey })` in
`src/server/modelProviders/utils.ts`, or `getCodexVercelAIModel` for the codex
gateway. They resolve the project's configured provider, keys and defaults, and
they are where cost attribution by `featureKey` happens. A hand-rolled
`createOpenAI(...)` bypasses all of it.

## Results aggregate across steps

In v7 the top-level `usage`, `content`, `toolCalls`, `toolResults`, `files`,
`sources` and `warnings` cover **every step**, not just the final one. `reasoning`,
`request`, `response` and `providerMetadata` moved onto `finalStep`. If you want
v6's "last step only" behaviour, read `result.finalStep`. Nothing in the app
currently reads these off a multi-step call, so there was no regression — but
a new multi-step caller that reads `usage` will over-count against v6 intuitions.

## Testing

Use the mock models from `ai/test` — `MockLanguageModelV3` is still exported in
v7, alongside a newer `MockLanguageModelV4`:

```ts
import { MockLanguageModelV3 } from "ai/test";
```

Assert the system prompt on `instructions`, not by searching `messages` for a
system entry. A helper that does `messages.find(m => m.role === "system")` will
find nothing and is the single most common way these tests fail after a hoist.

Run tests through the package scripts (`pnpm test:unit`, `pnpm test:component`,
`pnpm test:integration`) — see [vitest-performance.md](vitest-performance.md).

## Related

- `@langwatch/scenario` (separate repo) is ESM-only from 2.x, because `ai@7`
  publishes no CommonJS entry point. Any package here that depends on it and
  still emits CJS will not be able to load it.
- [logging-and-tracing.md](logging-and-tracing.md) — how spans reach the collector.
- [local-observability.md](local-observability.md) — querying them back with `gcx`.
