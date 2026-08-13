/**
 * AWS Bedrock Extractor
 *
 * Handles: spans from AWS SDK / boto3 instrumentation that carry Bedrock
 * Converse request/response payloads under `aws.bedrock.*` attribute keys
 * instead of the canonical `gen_ai.*` keys.
 * Reference: langwatch-saas#1040 (Branch 1 — no extractor read these keys,
 * so trace summaries degraded to span-name input / empty output while the
 * real content sat in the span).
 *
 * Detection: `rpc.service` = "BedrockRuntime", `gen_ai.system` /
 * `gen_ai.provider.name` = "aws.bedrock", or any `aws.bedrock.*` payload key.
 *
 * Canonical attributes produced:
 * - gen_ai.input.messages (from aws.bedrock.request.messages)
 * - gen_ai.output.messages (from aws.bedrock.response.output — the Converse
 *   API wraps the assistant turn as `{ output: { message: {...} } }`; the
 *   attribute may carry either the wrapper or the inner `{ message: {...} }`)
 * - gen_ai.request.model / gen_ai.response.model (from aws.bedrock.model_id)
 */

import { ATTR_KEYS } from "./_constants";
import {
  extractInputMessages,
  extractModelToBoth,
  recordValueType,
} from "./_extraction";
import { isRecord, safeJsonParse } from "./_guards";
import type { CanonicalAttributesExtractor, ExtractorContext } from "./_types";

const BEDROCK_ATTR_KEYS = {
  RPC_SERVICE: "rpc.service",
  MODEL_ID: "aws.bedrock.model_id",
  REQUEST_MESSAGES: "aws.bedrock.request.messages",
  RESPONSE_OUTPUT: "aws.bedrock.response.output",
} as const;

export class BedrockExtractor implements CanonicalAttributesExtractor {
  readonly id = "bedrock";

  apply(ctx: ExtractorContext): void {
    const { attrs } = ctx.bag;

    const isBedrock =
      attrs.get(BEDROCK_ATTR_KEYS.RPC_SERVICE) === "BedrockRuntime" ||
      attrs.get(ATTR_KEYS.GEN_AI_SYSTEM) === "aws.bedrock" ||
      attrs.get(ATTR_KEYS.GEN_AI_PROVIDER_NAME) === "aws.bedrock" ||
      attrs.has(BEDROCK_ATTR_KEYS.REQUEST_MESSAGES) ||
      attrs.has(BEDROCK_ATTR_KEYS.RESPONSE_OUTPUT) ||
      attrs.has(BEDROCK_ATTR_KEYS.MODEL_ID);

    if (!isBedrock) return;

    // ─────────────────────────────────────────────────────────────────────────
    // Model
    // ─────────────────────────────────────────────────────────────────────────
    extractModelToBoth(
      ctx,
      BEDROCK_ATTR_KEYS.MODEL_ID,
      (raw) => (typeof raw === "string" ? raw : null),
      `${this.id}:model(aws.bedrock.model_id)`,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Input Messages
    // Converse request messages ride verbatim: [{role, content:[{text}|...]}]
    // ─────────────────────────────────────────────────────────────────────────
    const inputExtracted = extractInputMessages(
      ctx,
      [{ type: "attr", keys: [BEDROCK_ATTR_KEYS.REQUEST_MESSAGES] }],
      `${this.id}:aws.bedrock.request.messages->gen_ai.input.messages`,
    );
    if (inputExtracted) {
      recordValueType(ctx, ATTR_KEYS.GEN_AI_INPUT_MESSAGES, "chat_messages");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Output Messages
    // The Converse response nests the assistant turn: unwrap `output` and/or
    // `message` wrappers down to the message object itself.
    // ─────────────────────────────────────────────────────────────────────────
    if (
      !attrs.has(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES) &&
      ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] === undefined
    ) {
      const raw = attrs.take(BEDROCK_ATTR_KEYS.RESPONSE_OUTPUT);
      if (raw !== undefined) {
        let parsed = safeJsonParse(raw);
        if (isRecord(parsed) && isRecord(parsed.output)) parsed = parsed.output;
        if (isRecord(parsed) && isRecord(parsed.message))
          parsed = parsed.message;
        if (isRecord(parsed) || Array.isArray(parsed)) {
          const messages = Array.isArray(parsed) ? parsed : [parsed];
          ctx.setAttr(ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES, messages);
          ctx.recordRule(
            `${this.id}:aws.bedrock.response.output->gen_ai.output.messages`,
          );
          recordValueType(
            ctx,
            ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
            "chat_messages",
          );
        }
      }
    }
  }
}
