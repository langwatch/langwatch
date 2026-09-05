import {
  LANGY_CARD_FAILED_PART_TYPE,
  LANGY_CARD_PART_TYPE,
  type LangyMessagePart,
  type LangyFinalToolCall,
  langyMessagePartSchema,
  salvageLangyDerivedCard,
  splitLangyCardFences,
} from "@langwatch/langy-contract";
import { LangyCliEnvelopeService } from "./langy-cli-envelope.service";
import type { LangyTurnSegment } from "../streaming/langy-turn-order";

export type LangyBlockCounter = (reason: string) => void;

/**
 * A tool call the agent ran during a turn, in the compact form both the backend relay (accumulated
 * off the NDJSON stream) and the durable HTTP-final ingest (posted by the agent) carry. `output`
 * doubles as the error text when `isError` — the wire keeps a single field.
 */
export type { LangyFinalToolCall } from "@langwatch/langy-contract";

/**
 * Assemble the durable assistant-message parts for a finalized turn: the tool cards this turn ran
 * are placed BEFORE the prose,
 * parts on either side (ADR-060 §1).
 */
export class LangyFinalPartsService {
  private constructor(private readonly cliEnvelope: LangyCliEnvelopeService) {}

  static create(): LangyFinalPartsService {
    return new LangyFinalPartsService(LangyCliEnvelopeService.create());
  }

  build({
    text,
    toolCalls = [],
    order,
    countBlock = () => undefined,
  }: {
    text: string;
    toolCalls?: LangyFinalToolCall[];
    order?: readonly LangyTurnSegment[];
    countBlock?: LangyBlockCounter;
  }): LangyMessagePart[] {
    if (!order?.length) {
      return [
        ...toolCalls.map((call) => this.toolPart(call)),
        ...this.assistantTextParts(text, countBlock),
      ];
    }

    return this.orderedParts({ text, toolCalls, order, countBlock });
  }

  private toolPart(rawCall: LangyFinalToolCall): LangyMessagePart {
    const call = this.cliEnvelope.normalizeToolFrame({
      frame: { ...rawCall, phase: "end" },
    });

    return langyMessagePartSchema.parse({
      type: `tool-${call.name}`,
      toolCallId: call.id,
      state: call.isError ? "output-error" : "output-available",
      ...(call.input !== undefined ? { input: call.input } : {}),
      ...(call.digest !== undefined ? { digest: call.digest } : {}),
      ...(call.result !== undefined ? { result: call.result } : {}),
      ...(call.isError
        ? { errorText: call.output ?? "Tool call failed" }
        : { output: call.output ?? "" }),
    });
  }

  private orderedParts({
    text,
    toolCalls,
    order,
    countBlock,
  }: {
    text: string;
    toolCalls: LangyFinalToolCall[];
    order: readonly LangyTurnSegment[];
    countBlock: LangyBlockCounter;
  }): LangyMessagePart[] {
    const last = order.at(-1);
    const endedOnParagraph = last?.kind === "text" && last.text.trim() !== "";
    const callsById = new Map(toolCalls.map((call) => [call.id, call]));
    const recorded = new Set<string>();
    const parts: LangyMessagePart[] = [];
    let hasProse = false;

    for (const [index, segment] of order.entries()) {
      if (segment.kind === "tool") {
        const call = callsById.get(segment.id);
        if (call && !recorded.has(call.id)) {
          recorded.add(call.id);
          parts.push(this.toolPart(call));
        }

        continue;
      }

      if ((endedOnParagraph && index === order.length - 1) || segment.text.trim() === "") {
        continue;
      }

      hasProse = true;
      parts.push(...this.assistantTextParts(segment.text, countBlock));
    }

    const unrecorded = toolCalls.filter((call) => !recorded.has(call.id));
    parts.push(...unrecorded.map((call) => this.toolPart(call)));
    if (endedOnParagraph || !hasProse) {
      parts.push(...this.assistantTextParts(text, countBlock));
    }

    return parts;
  }

  /**
   * The assistant's prose, with every ```langy-card fence stamped into a
   * typed part IN PLACE (ADR-060 §1). The relay stamp — the one decision
   * point for the model's block channel.
   */
  private assistantTextParts(text: string, countBlock: LangyBlockCounter): LangyMessagePart[] {
    const segments = splitLangyCardFences(text);
    if (!segments.some((segment) => segment.type === "fence")) {
      // Fence-less turns record byte-for-byte what they always did, including
      // the empty text part of an empty answer.
      return [{ type: "text", text, role: "assistant" }];
    }

    const parts: LangyMessagePart[] = [];
    let ordinal = 0;
    for (const segment of segments) {
      if (segment.type === "text") {
        parts.push({ type: "text", text: segment.text, role: "assistant" });
        continue;
      }

      ordinal += 1;
      const parsed = salvageLangyDerivedCard(segment.raw);
      if (parsed.ok) {
        countBlock("stamped");
        parts.push(
          langyMessagePartSchema.parse({
            type: LANGY_CARD_PART_TYPE,
            blockId: parsed.card.blockId,
            kind: parsed.card.kind,
            provenance: "derived",
            card: parsed.card,
            ...(parsed.card.hints !== undefined ? { hints: parsed.card.hints } : {}),
          }),
        );
        continue;
      }

      countBlock(parsed.reason);
      parts.push({
        type: LANGY_CARD_FAILED_PART_TYPE,
        blockId: `failed-block-${ordinal}`,
        raw: segment.raw,
      });
    }

    return parts;
  }
}
