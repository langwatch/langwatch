/** Maps Mastra span metadata, model-step I/O, and thread IDs to canonical keys. */

import { ATTR_KEYS } from "@langwatch/trace-contract";
import { recordValueType } from "../canonical-extraction.rules";
import { asNumber } from "../canonical-guard.rules";
import {
  extractLastUserMessageText,
  extractSystemInstructionFromMessages,
  normalizeToMessages,
  stripSystemMessages,
} from "../canonical-message.rules";
import { MastraValues } from "../mastra-value.rules";
import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../../ports/canonical-attributes.port";

export class MastraCanonicaliser implements CanonicalAttributesPort {
  readonly id = "mastra";

  apply(ctx: ExtractorContext): void {
    if (!this.detectMastra(ctx)) {
      return;
    }

    const mastraType = ctx.bag.attrs.get(ATTR_KEYS.MASTRA_SPAN_TYPE);
    const rawModelStepInput = ctx.bag.attrs.get(ATTR_KEYS.MASTRA_MODEL_STEP_INPUT);
    const modelStepBody = MastraValues.extractBodyFromModelStepInput(rawModelStepInput);

    // Detect eval model_step: orphan (no parent) OR has response_format (structured output eval)
    const isEvalModelStep =
      mastraType === "model_step" &&
      (!ctx.span.parentSpanId || MastraValues.hasResponseFormat(modelStepBody));

    this.mapSpanType(ctx, mastraType, isEvalModelStep);
    const modelName = this.extractModelInfo(ctx, modelStepBody);
    this.extractIO(ctx, mastraType, isEvalModelStep, modelStepBody);
    this.setDisplayName(ctx, mastraType, modelName, isEvalModelStep, modelStepBody);
    this.extractThreadId(ctx);
    this.mapTokenNames(ctx);
  }

  /** Detection check: only process spans from Mastra instrumentation. */
  private detectMastra(ctx: ExtractorContext): boolean {
    const scopeName = ctx.span.instrumentationScope?.name ?? "";
    return (
      scopeName === "@mastra/otel" ||
      scopeName === "@mastra/otel-bridge" ||
      scopeName.startsWith("@mastra/") ||
      ctx.bag.attrs.has(ATTR_KEYS.MASTRA_SPAN_TYPE)
    );
  }

  /** Map Mastra's detailed span types to canonical types.
   *  Respects user-explicit langwatch.span.type (in bag) but overrides
   *  types inferred by earlier extractors (in ctx.out). */
  private mapSpanType(ctx: ExtractorContext, mastraType: unknown, isEvalModelStep: boolean): void {
    // User explicitly set langwatch.span.type — respect it
    if (ctx.bag.attrs.has(ATTR_KEYS.SPAN_TYPE)) {
      return;
    }
    ctx.setAttr(
      ATTR_KEYS.SPAN_TYPE,
      MastraValues.mastraSpanTypeToCanonical(mastraType, isEvalModelStep),
    );
    ctx.recordRule(`${this.id}:mastra.span.type->langwatch.span.type`);
  }

  /** Extract model name from body.model and metadata fallback; set gen_ai model attrs. */
  private extractModelInfo(
    ctx: ExtractorContext,
    modelStepBody: Record<string, unknown> | null,
  ): string | null {
    const { attrs } = ctx.bag;
    let modelName: string | null = null;

    if (modelStepBody) {
      // Extract model name from body.model
      if (typeof modelStepBody.model === "string" && modelStepBody.model.length > 0) {
        modelName = modelStepBody.model;
        if (
          !attrs.has(ATTR_KEYS.GEN_AI_REQUEST_MODEL) &&
          !attrs.has(ATTR_KEYS.GEN_AI_RESPONSE_MODEL)
        ) {
          ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_MODEL, modelName);
          ctx.setAttr(ATTR_KEYS.GEN_AI_RESPONSE_MODEL, modelName);
          ctx.recordRule(`${this.id}:model_step.input.body.model->gen_ai.model`);
        }
      }

      // Extract input messages from body.messages
      if (
        Array.isArray(modelStepBody.messages) &&
        !attrs.has(ATTR_KEYS.GEN_AI_INPUT_MESSAGES) &&
        ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] === void 0
      ) {
        const msgs = normalizeToMessages(modelStepBody.messages, "user");
        if (msgs && msgs.length > 0) {
          const systemInstruction = extractSystemInstructionFromMessages(msgs);
          // Strip system messages — they go to gen_ai.system_instructions
          const chatMsgs = systemInstruction ? stripSystemMessages(msgs) : msgs;
          if (chatMsgs.length > 0) {
            ctx.setAttr(ATTR_KEYS.GEN_AI_INPUT_MESSAGES, chatMsgs);
            recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
          }
          if (systemInstruction !== null) {
            ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstruction);
          }
          ctx.recordRule(`${this.id}:model_step.input.body.messages->gen_ai.input.messages`);
        }
      }
    }

    // Fallback: try mastra.metadata.modelMetadata for model name
    if (!modelName) {
      modelName = MastraValues.extractModelFromMetadata(attrs);
      if (
        modelName &&
        !attrs.has(ATTR_KEYS.GEN_AI_REQUEST_MODEL) &&
        !attrs.has(ATTR_KEYS.GEN_AI_RESPONSE_MODEL) &&
        ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL] === void 0
      ) {
        ctx.setAttr(ATTR_KEYS.GEN_AI_REQUEST_MODEL, modelName);
        ctx.setAttr(ATTR_KEYS.GEN_AI_RESPONSE_MODEL, modelName);
        ctx.recordRule(`${this.id}:metadata.modelMetadata->gen_ai.model`);
      }
    }

    return modelName;
  }

  /** Map Mastra-specific I/O attributes to canonical langwatch.input/output. */
  private extractIO(
    ctx: ExtractorContext,
    mastraType: unknown,
    isEvalModelStep: boolean,
    modelStepBody: Record<string, unknown> | null,
  ): void {
    const { attrs } = ctx.bag;

    // For agent_run spans: extract I/O from mastra.agent_run.input/output
    if (mastraType === "agent_run") {
      if (!attrs.has(ATTR_KEYS.LANGWATCH_INPUT)) {
        const rawInput = attrs.get(ATTR_KEYS.MASTRA_AGENT_RUN_INPUT);
        if (rawInput !== void 0) {
          const lastUserMessage = extractLastUserMessageText(rawInput);
          if (lastUserMessage) {
            ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, lastUserMessage);
            ctx.recordRule(`${this.id}:mastra.agent_run.input->langwatch.input`);
          }
        }
      }

      if (!attrs.has(ATTR_KEYS.LANGWATCH_OUTPUT)) {
        const rawOutput = attrs.get(ATTR_KEYS.MASTRA_AGENT_RUN_OUTPUT);
        if (rawOutput !== void 0) {
          const text = MastraValues.extractTextFromOutput(rawOutput);
          if (text) {
            ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, text);
            ctx.recordRule(`${this.id}:mastra.agent_run.output->langwatch.output`);
          }
        }
      }
    }

    // For model_step spans: extract text from mastra.model_step.output
    if (mastraType === "model_step" && !attrs.has(ATTR_KEYS.LANGWATCH_OUTPUT)) {
      const rawOutput = attrs.get(ATTR_KEYS.MASTRA_MODEL_STEP_OUTPUT);
      if (rawOutput !== void 0) {
        if (isEvalModelStep) {
          // For orphan eval spans: prefer structured object, fall back to text
          const evalOutput = MastraValues.extractEvalOutput(rawOutput);
          if (evalOutput != null) {
            ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, evalOutput);
            ctx.recordRule(`${this.id}:orphan.model_step.output->langwatch.output`);
          }
        } else {
          const text = MastraValues.extractTextFromOutput(rawOutput);
          if (text) {
            ctx.setAttr(ATTR_KEYS.LANGWATCH_OUTPUT, text);
            if (
              ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] === void 0 &&
              !ctx.bag.attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES)
            ) {
              ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, [{ role: "assistant", content: text }]);
              recordValueType(ctx, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, "chat_messages");
            }
            ctx.recordRule(`${this.id}:mastra.model_step.output->langwatch.output`);
          }
        }
      }
    }

    // For orphan eval spans: extract system prompt as input
    if (isEvalModelStep && !attrs.has(ATTR_KEYS.LANGWATCH_INPUT)) {
      const systemPrompt = MastraValues.extractSystemPromptFromBody(modelStepBody);
      if (systemPrompt) {
        ctx.setAttr(ATTR_KEYS.LANGWATCH_INPUT, systemPrompt);
        ctx.recordRule(`${this.id}:orphan.system_prompt->langwatch.input`);
      }
    }
  }

  /** Set contextual display names based on span type and model. */
  private setDisplayName(
    ctx: ExtractorContext,
    mastraType: unknown,
    modelName: string | null,
    isEvalModelStep: boolean,
    modelStepBody: Record<string, unknown> | null,
  ): void {
    const displayName = MastraValues.deriveDisplayName({
      mastraType,
      modelName,
      isOrphan: isEvalModelStep,
      modelStepBody,
    });
    if (displayName) {
      ctx.span.name = displayName;
      ctx.recordRule(`${this.id}:display_name`);
    }
  }

  /** Extract threadId and map to gen_ai.conversation.id. */
  private extractThreadId(ctx: ExtractorContext): void {
    const threadId = ctx.bag.attrs.take(ATTR_KEYS.MASTRA_METADATA_THREAD_ID);
    if (typeof threadId === "string" && threadId.length > 0) {
      ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_CONVERSATION_ID, threadId);
      ctx.recordRule(`${this.id}:mastra.metadata.threadId->conversation.id`);
    }
  }

  /** Map non-standard cached_input_tokens to canonical cache_read.input_tokens. */
  private mapTokenNames(ctx: ExtractorContext): void {
    const cachedTokens = ctx.bag.attrs.take(ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS);
    if (cachedTokens !== void 0) {
      const n = asNumber(cachedTokens);
      if (n !== null) {
        ctx.setAttrIfAbsent(ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, n);
        ctx.recordRule(`${this.id}:cached_input_tokens->cache_read.input_tokens`);
      }
    }
  }
}
