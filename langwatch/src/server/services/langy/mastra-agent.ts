/**
 * Mastra-backed Langy chat agent (PR-4.3 spike, PR-4.4 memory adoption).
 *
 * Drop-in alternative to the legacy `streamText` path in `routes/langy.ts`.
 * Gated by the `release_ui_langy_mastra_enabled` feature flag — when off,
 * the legacy AI-SDK path still serves traffic; this module is unimported.
 *
 * PR-4.4b: memory is now bound to the Agent via `LangyMastraMemory`, which
 * persists assistant + tool turns through Mastra's native saveMessages
 * pipeline (sole writer on this path; the legacy `onFinish` hook is no
 * longer attached when this path serves). The route hands us just the new
 * user `ModelMessage`; prior history is loaded via `memory.recall` on the
 * thread (`conversationId`).
 *
 * Tool surface: identical. `buildLangyTools(ctx)` produces AI-SDK `tool({})`
 * objects today, and Mastra's `isVercelTool` check accepts them as-is.
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
import type { LangyMastraMemory } from "./langy-mastra-memory";

export interface StreamLangyMastraOptions {
  ctx: LangyConversationContext;
  model: LanguageModel;
  systemPrompt: string;
  /**
   * The new user turn only. Mastra's memory adapter loads prior history
   * via `recall(threadId)` — we no longer pass the full transcript.
   */
  message: ModelMessage;
  maxSteps: number;
  memory: LangyMastraMemory;
  /** Mastra thread (Langy `conversationId`). */
  threadId: string;
  /** Mastra resource (Langy `projectId`). */
  resourceId: string;
}

/**
 * Per-request Agent. Mastra's `Agent` is cheap to construct (no I/O in the
 * ctor — just config), so we build a fresh one per chat POST. This keeps
 * `tools` bound to the per-request `LangyConversationContext` (projectId,
 * seenIds, etc.) and `memory` bound to the same per-request scope without
 * juggling per-call tool overrides on a shared instance.
 */
export async function streamLangyMastraResponse({
  ctx,
  model,
  systemPrompt,
  message,
  maxSteps,
  memory,
  threadId,
  resourceId,
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
    memory,
  });

  const stream = await agent.stream([message], {
    system: systemPrompt,
    maxSteps,
    memory: { thread: threadId, resource: resourceId },
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
