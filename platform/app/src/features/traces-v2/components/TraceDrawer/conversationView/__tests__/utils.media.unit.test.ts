/**
 * Which media a turn's user message and its reply each carry: the fold-derived
 * references when the turn has them, the walked payload when it does not, and
 * the same side rule as the trace summary strips either way.
 */
import { describe, expect, it } from "vitest";
import type { TraceMediaRef } from "~/shared/traces/media-refs";
import { turnMediaForSide } from "../utils";

const CALLER = "/api/files/project-1/caller";
const REPLY = "/api/files/project-1/reply";

const audioRef = (
  url: string,
  role?: TraceMediaRef["role"],
): TraceMediaRef => ({ kind: "audio", url, ...(role ? { role } : {}) });

const urls = (parts: ReturnType<typeof turnMediaForSide>): string[] =>
  parts.map((part) =>
    part.type === "binary" ? (part.url ?? "") : part.source.value,
  );

describe("turnMediaForSide", () => {
  describe("given a turn whose references carry both sides of a voice call", () => {
    const refs = [audioRef(CALLER, "user"), audioRef(REPLY, "assistant")];

    it("keeps the caller's recording on the input side", () => {
      expect(
        urls(turnMediaForSide({ refs, value: null, side: "input" })),
      ).toEqual([CALLER]);
    });

    it("keeps the reply recording on the output side", () => {
      expect(
        urls(turnMediaForSide({ refs, value: null, side: "output" })),
      ).toEqual([REPLY]);
    });
  });

  describe("given references with no role recorded", () => {
    const refs = [audioRef(CALLER)];

    it("renders them on either side asked for", () => {
      expect(
        urls(turnMediaForSide({ refs, value: null, side: "input" })),
      ).toEqual([CALLER]);
      expect(
        urls(turnMediaForSide({ refs, value: null, side: "output" })),
      ).toEqual([CALLER]);
    });
  });

  describe("given a turn handed over with its raw payload and no references", () => {
    const value = JSON.stringify([
      {
        role: "user",
        content: [{ type: "input_audio", input_audio: { url: CALLER } }],
      },
      {
        role: "assistant",
        content: [{ type: "input_audio", input_audio: { url: REPLY } }],
      },
    ]);

    it("walks the payload and splits it by the role each part sat under", () => {
      expect(
        urls(turnMediaForSide({ refs: undefined, value, side: "input" })),
      ).toEqual([CALLER]);
      expect(
        urls(turnMediaForSide({ refs: undefined, value, side: "output" })),
      ).toEqual([REPLY]);
    });

    it("reaches media through a nested JSON string", () => {
      const nested = JSON.stringify({
        type: "raw",
        value: JSON.stringify([
          {
            role: "user",
            content: [{ type: "input_audio", input_audio: { url: CALLER } }],
          },
        ]),
      });

      expect(
        urls(
          turnMediaForSide({ refs: undefined, value: nested, side: "input" }),
        ),
      ).toEqual([CALLER]);
    });
  });

  describe("given references and a payload both carrying media", () => {
    it("reads the references, which is what the fold recorded", () => {
      const value = JSON.stringify([
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { url: REPLY } }],
        },
      ]);

      expect(
        urls(
          turnMediaForSide({
            refs: [audioRef(CALLER, "user")],
            value,
            side: "input",
          }),
        ),
      ).toEqual([CALLER]);
    });
  });

  describe("given a turn with no media at all", () => {
    it("returns nothing for either side", () => {
      expect(
        turnMediaForSide({ refs: [], value: "just text", side: "input" }),
      ).toHaveLength(0);
      expect(
        turnMediaForSide({ refs: undefined, value: null, side: "output" }),
      ).toHaveLength(0);
    });
  });
});
