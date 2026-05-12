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
import type { LangyToolContext } from "./tools";
import { buildLangyTools } from "./tools";

export interface StreamLangyMastraOptions {
  ctx: LangyToolContext;
  model: LanguageModel;
  systemPrompt: string;
  messages: ModelMessage[];
  maxSteps: number;
  onFinish?: (result: {
    text?: string;
    response?: unknown;
  }) => void | Promise<void>;
}

/**
 * Per-request Agent. Mastra's `Agent` is cheap to construct (no I/O in the
 * ctor — just config), so we build a fresh one per chat POST. This keeps
 * `tools` bound to the per-request `LangyToolContext` (projectId, seenIds,
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
    model,
    tools,
  });

  const stream = await agent.stream(messages, {
    system: systemPrompt,
    maxSteps,
    ...(onFinish ? { onFinish } : {}),
  });

  return createUIMessageStreamResponse({
    stream: toAISdkV5Stream(stream, { from: "agent" }),
  });
}
