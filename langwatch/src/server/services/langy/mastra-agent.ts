/**
 * Mastra-backed Langy chat agent (PR-4.3 spike).
 *
 * Drop-in alternative to the legacy `streamText` path in `routes/langy.ts`.
 * Gated by the `release_ui_langy_mastra_enabled` feature flag — when off,
 * the legacy AI-SDK path still serves traffic; this module is unimported.
 *
 * Tool surface: identical. `buildLangyTools(ctx)` produces AI-SDK `tool({})`
 * objects today, and Mastra's `isVercelTool` check accepts them as-is.
 * No spec-extraction refactor was needed.
 *
 * Frontend parity: `toAISdkV5Stream` + `createUIMessageStreamResponse`
 * produce the same UI message stream the existing `DefaultChatTransport`
 * already consumes — `LangySidebar.tsx` doesn't need to change.
 */
import type { LanguageModel } from "ai";
import { createUIMessageStreamResponse, type ModelMessage } from "ai";
import { Agent } from "@mastra/core/agent";
import { toAISdkV5Stream } from "@mastra/ai-sdk";
import type { LangyConversationContext } from "./tools";
import { buildLangyTools } from "./tools";

export interface StreamLangyMastraOptions {
  ctx: LangyConversationContext;
  model: LanguageModel;
  systemPrompt: string;
  messages: ModelMessage[];
  maxSteps: number;
  /**
   * Optional persistence/telemetry callback fired when the stream completes.
   * Typed `(args: any) => …` because Mastra's `MastraOnFinishCallback<OUTPUT>`
   * carries a deep generic (`LLMStepResult<OUTPUT>`) whose extras (steps,
   * usage, runId, etc.) the Langy callback doesn't consume — chasing the
   * exact type adds noise without value. The actual shape we read is
   * `{ text: string; response: { messages?: [...] } }` and the route's
   * `buildLangyAssistantOnFinish` is the canonical implementation.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onFinish?: (args: any) => void | Promise<void>;
}

/**
 * Per-request Agent. Mastra's `Agent` is cheap to construct (no I/O in the
 * ctor — just config), so we build a fresh one per chat POST. This keeps
 * `tools` bound to the per-request `LangyConversationContext` (projectId, seenIds,
 * etc.) without juggling per-call tool overrides on a shared instance.
 */
export async function streamLangyMastraResponse({
  ctx,
  model,
  systemPrompt,
  messages,
  maxSteps,
  onFinish,
}: StreamLangyMastraOptions): Promise<Response> {
  const tools = buildLangyTools(ctx);

  const agent = new Agent({
    id: "langy",
    name: "Langy",
    instructions: systemPrompt,
    // @ts-expect-error Mastra ↔ AI SDK v6 type bridge gap (Phase 4.3 spike).
    // `Agent` expects `DynamicArgument<ModelWithRetries[] | MastraModelConfig, unknown>`
    // but we pass a plain AI-SDK `LanguageModel`. Mastra accepts it at runtime
    // (its `isVercelModel` check); the wrapper type belongs in Phase 4.5 cutover.
    model,
    tools,
  });

  const stream = await agent.stream(messages, {
    system: systemPrompt,
    maxSteps,
    ...(onFinish ? { onFinish } : {}),
  });

  return createUIMessageStreamResponse({
    // @ts-expect-error Mastra ↔ AI SDK v6 type bridge gap (Phase 4.3 spike).
    // `toAISdkV5Stream` returns `ReadableStream<InferUIMessageChunk<UIMessage<..., UITools>>>`,
    // `createUIMessageStreamResponse` wants `ReadableStream<UIMessageChunk<..., UIDataTypes>>`.
    // Chunk shape matches at runtime; the generic `UITools` parameter is the only mismatch.
    // Resolve at Phase 4.5 cutover when this path becomes the default.
    stream: toAISdkV5Stream(stream, { from: "agent" }),
  });
}
