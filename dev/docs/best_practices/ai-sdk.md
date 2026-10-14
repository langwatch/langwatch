# Vercel AI SDK

The workspace is on **AI SDK 7**. One `ai` version governs it: the `ai` entry in
the pnpm catalog and the matching `ai` override in `pnpm-workspace.yaml`. The
provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, ...)
must stay on their v7-line majors: `openai` 4.x, `anthropic` 4.x, `google` 4.x,
`openai-compatible` 3.x, `react` 4.x, `otel` 1.x. A provider from the wrong major
installs cleanly and then fails at the model boundary.

`@ai-sdk/react` and `@ai-sdk/otel` depend on `ai` at an exact version rather than
declaring it as a peer, so pnpm never notices when the two drift apart. The `ai`
override is what keeps a single copy installed; bump the family together.

Bumping any of them goes through the release-age gate; see
[dependency-age-gates.md](dependency-age-gates.md).

## The v7 traps are invisible to the compiler

v7 kept a deprecated alias for nearly everything it renamed, so a typecheck
passes on code that is broken at runtime. Do not treat a green typecheck as
evidence that AI SDK code works.

| Change | Compiler | What actually happens |
|---|---|---|
| `role: "system"` inside `messages` | silent | throws `InvalidPromptError` on every call |
| telemetry without `registerTelemetry` | silent | zero spans emitted |
| span scope `ai` to `gen_ai` | silent | scope-matching filters drop every span |
| top-level `usage` now spans all steps | silent | numbers grow; no error |
| `system:`, `stepCountIs`, `experimental_telemetry` | silent | still work (deprecated aliases) |

## Never put a system message in `messages`

v7 rejects a `role: "system"` entry inside `messages` or `prompt`; v6 only warned.
Pass the system prompt as top-level `instructions`:

```ts
// wrong: throws InvalidPromptError
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

`allowSystemInMessages: true` switches the check off. It is correct only when the
transcript legitimately carries system turns you did not author and must not
move. Two places qualify: the playground service in the model-provider module,
where a signed-in user deliberately authors and tests their own system turns, and
the scenario prompt-config channel, where a scenario author may have scripted one.
Both say so in a comment. Where `messages` is unvalidated input and a system turn
would be injected rather than authored, leave the check on: rejecting it is
prompt-injection defence.

Hoisting the system message shifts every later index by one. Check the
surrounding function for `slice`, `[0]`, `[1]` and length assertions.

## Telemetry does not exist until you register it

In v6, OpenTelemetry was built into `ai` and `experimental_telemetry:
{ isEnabled: true }` was enough. In v7 it lives in `@ai-sdk/otel` and emits
nothing until an integration is registered, with no warning.

```ts
import { registerTelemetry } from "ai";
import { OpenTelemetry } from "@ai-sdk/otel";

setupObservability({ serviceName: "..." });
registerTelemetry(new OpenTelemetry()); // once, at startup
```

Once registered, telemetry is on for every call; there is no per-call flag.

- **The instrumentation scope changed from `ai` to `gen_ai`.** Anything matching
  on scope name must accept both. `isVercelAiSpan` in the TypeScript SDK
  (`sdks/typescript/src/observability-sdk/exporters/trace-filters.ts`) checks for
  either.
- **Span names changed too**: `chat <model>`, `step N`, `invoke_agent <model>`,
  where v6 emitted `ai.generateText` and `ai.generateText.doGenerate`.
- **Time to first chunk** arrives as `gen_ai.client.operation.time_to_first_chunk`
  in seconds; the span normalisation package canonicalises it onto
  `gen_ai.server.time_to_first_token`.

Anything we ship that tells a customer how to send us AI SDK traces (docs, SDK
examples, the onboarding snippet under
`modules/onboarding/browser/src/ui/sections/observability/codegen/snippets/`) must
include the `registerTelemetry` call and list `@ai-sdk/otel` in its install
command. Without it the customer sees no data and concludes LangWatch is broken.

## Resolve models through the model-provider module

Never construct a provider inline in a route, service or channel of another
module. Other modules call the model-provider module's `*Api` (`generateText`,
structured generation), which resolves the project's configured provider, keys
and defaults and applies `featureKey` cost attribution. A hand-rolled
`createOpenAI(...)` bypasses all of it. The AI SDK itself is called only from
inside that module's services and channels.

## Results aggregate across steps

In v7 the top-level `usage`, `content`, `toolCalls`, `toolResults`, `files`,
`sources` and `warnings` cover every step. `reasoning`, `request`, `response` and
`providerMetadata` moved onto `finalStep`. For v6's "last step only" behaviour,
read `result.finalStep`.

## Testing

Use the mock models from `ai/test`; `MockLanguageModelV4` matches the v7 provider
spec. Assert the system prompt on `instructions`, not by searching `messages` for
a system entry: a helper that does `messages.find(m => m.role === "system")`
finds nothing after a hoist.

## The scenario library is still on AI SDK 6

`@langwatch/scenario` (the vendored build and the published 1.7.0) depends on
`ai` `^6` and sends `role: "system"` messages inside `messages`. Handing it a v7
model, or letting the `ai` override reach it, breaks its judge and user
simulator. Until a scenario release supports AI SDK 7, treat every place that
passes an `@ai-sdk/*` model into `@langwatch/scenario` as a known risk.

## Related

- [logging-and-tracing.md](logging-and-tracing.md): how spans reach the collector.
- [local-observability.md](local-observability.md): querying them back with `gcx`.
