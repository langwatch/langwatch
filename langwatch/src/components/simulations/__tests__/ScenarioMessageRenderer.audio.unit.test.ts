/**
 * @vitest-environment node
 *
 * Unit tests for the audio-content-part flattening path in
 * ScenarioMessageRenderer (lw#3552).
 *
 * @see specs/scenarios/inline-audio-player.feature
 */

import { describe, expect, it } from "vitest";
import {
  flattenMessages,
  type DisplayItem,
} from "../ScenarioMessageRenderer";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";

type RawMessage = ScenarioMessageSnapshotEvent["messages"][number];

const LONG_BASE64 = "U".repeat(200);

function makeAudioMessage(
  type: "input_audio" | "audio",
  data: string,
  format: string | undefined,
  role: RawMessage["role"] = "user",
): RawMessage {
  const part: Record<string, unknown> = { type };
  const payload: Record<string, unknown> = { data };
  if (format !== undefined) {
    payload.format = format;
  }
  part[type] = payload;
  return {
    id: `msg-${type}`,
    role,
    content: [part as unknown],
  } as unknown as RawMessage;
}

function audioItems(items: DisplayItem[]): Extract<DisplayItem, { kind: "audio" }>[] {
  return items.filter(
    (i): i is Extract<DisplayItem, { kind: "audio" }> => i.kind === "audio",
  );
}

describe("ScenarioMessageRenderer flatten — audio (lw#3552)", () => {
  describe("given an OpenAI-style input_audio content part", () => {
    /** @scenario detects an OpenAI-style input_audio content part */
    it("emits a single audio entry with a wav data URL", () => {
      const items = flattenMessages([
        makeAudioMessage("input_audio", LONG_BASE64, "wav"),
      ]);
      const audio = audioItems(items);
      expect(audio).toHaveLength(1);
      expect(audio[0]!.src.startsWith("data:audio/wav;base64,")).toBe(true);
      expect(audio[0]!.src.endsWith(LONG_BASE64)).toBe(true);
      expect(audio[0]!.missing).toBe(false);
    });
  });

  describe("given an alternate-provider audio content part", () => {
    /** @scenario detects an alternate-provider audio content part */
    it("emits an audio entry with the provider's format", () => {
      const items = flattenMessages([
        makeAudioMessage("audio", LONG_BASE64, "mp3"),
      ]);
      const audio = audioItems(items);
      expect(audio).toHaveLength(1);
      expect(audio[0]!.src.startsWith("data:audio/mp3;base64,")).toBe(true);
    });
  });

  describe("given the SDK omits format on the audio payload", () => {
    /** @scenario defaults format to wav when the SDK omits it */
    it("falls back to wav in the data URL", () => {
      const items = flattenMessages([
        makeAudioMessage("input_audio", LONG_BASE64, undefined),
      ]);
      const audio = audioItems(items);
      expect(audio).toHaveLength(1);
      expect(audio[0]!.src.startsWith("data:audio/wav;base64,")).toBe(true);
    });
  });

  describe("given a suspiciously short audio payload", () => {
    /** @scenario marks suspiciously short payloads as missing */
    it("flags the audio entry as missing", () => {
      const items = flattenMessages([
        makeAudioMessage("input_audio", "x", "wav"),
      ]);
      const audio = audioItems(items);
      expect(audio).toHaveLength(1);
      expect(audio[0]!.missing).toBe(true);
    });
  });

  describe("given a mixed-content message (text + audio)", () => {
    /** @scenario keeps text alongside audio in mixed-content messages */
    it("emits both a text entry and an audio entry", () => {
      const mixed = {
        id: "msg-mixed",
        role: "user",
        content: [
          { type: "text", text: "hi" },
          {
            type: "input_audio",
            input_audio: { data: LONG_BASE64, format: "wav" },
          },
        ],
      } as unknown as RawMessage;

      const items = flattenMessages([mixed]);
      const text = items.find((i) => i.kind === "text");
      const audio = items.find((i) => i.kind === "audio");
      expect(text && (text as { content: string }).content).toBe("hi");
      expect(audio).toBeDefined();
    });
  });
});
