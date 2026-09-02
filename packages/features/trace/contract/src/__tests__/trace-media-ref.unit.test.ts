import { describe, expect, it } from "vitest";
import {
  collectAnnotatedMediaParts,
  collectMediaRefs,
  MAX_TRACE_MEDIA_REFS,
  mediaRefBelongsToSide,
  mediaRoleBelongsToSide,
  mergeMediaRefs,
  parseMediaRefs,
  RESERVED_INPUT_MEDIA_REFS,
  RESERVED_OUTPUT_MEDIA_REFS,
  serializeMediaRefList,
  type TraceMediaRef,
} from "../index";

/**
 * The compact media references the trace summary carries, harvested from
 * `platform/app/src/shared/traces/media-refs.ts` in step (g1).
 *
 * Every pin here is a LITERAL rather than a read of the application's source:
 * the column has one writer and three readers, and a format they disagree
 * about is a thumbnail that silently resolves to nothing.
 */

const storedImage = {
  role: "user",
  content: [{ type: "image_url", image_url: { url: "/api/files/proj_1/img_a" } }],
};
const storedAudioReply = {
  role: "assistant",
  content: [
    {
      type: "input_audio",
      input_audio: { url: "/api/files/proj_1/aud_b", format: "wav" },
    },
  ],
};

describe("given the reserved attribute names the summary writes references under", () => {
  describe("when the attribute keys are read", () => {
    /** @scenario "a reference the projection wrote is read back whole" */
    it("names the two reserved keys the fold stamps and the read path strips", () => {
      expect(RESERVED_INPUT_MEDIA_REFS).toBe("langwatch.reserved.media_refs.input");
      expect(RESERVED_OUTPUT_MEDIA_REFS).toBe("langwatch.reserved.media_refs.output");
    });
  });
});

describe("given a span payload carrying stored media", () => {
  describe("when the references are collected, serialised and parsed back", () => {
    /** @scenario "a reference the projection wrote is read back whole" */
    it("round-trips the kinds, addresses and roles unchanged", () => {
      const refs = collectMediaRefs([storedImage, storedAudioReply]);

      expect(refs).toEqual([
        { kind: "image", url: "/api/files/proj_1/img_a", role: "user" },
        { kind: "audio", url: "/api/files/proj_1/aud_b", role: "assistant" },
      ]);

      const serialized = serializeMediaRefList(refs);
      expect(serialized).toBe(
        '[{"kind":"image","url":"/api/files/proj_1/img_a","role":"user"},' +
          '{"kind":"audio","url":"/api/files/proj_1/aud_b","role":"assistant"}]',
      );
      expect(parseMediaRefs(serialized)).toEqual(refs);
    });

    /** @scenario "a reference the projection wrote is read back whole" */
    it("writes nothing at all rather than an empty list", () => {
      expect(serializeMediaRefList([])).toBeNull();
      expect(parseMediaRefs(null)).toEqual([]);
      expect(parseMediaRefs("not json")).toEqual([]);
      expect(parseMediaRefs('{"kind":"image"}')).toEqual([]);
    });
  });
});

describe("given media pointing somewhere other than our own file route", () => {
  describe("when the references are collected and parsed", () => {
    /** @scenario "a reference to anywhere but our own file route is refused" */
    it("refuses an external address on the way out and on the way back in", () => {
      const external = {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "https://evil.test/pixel.png" } }],
      };

      expect(collectMediaRefs([external])).toEqual([]);
      expect(parseMediaRefs('[{"kind":"image","url":"https://evil.test/pixel.png"}]')).toEqual([]);
    });

    /** @scenario "a reference to anywhere but our own file route is refused" */
    it("refuses a traversal that would escape the files route after normalization", () => {
      expect(parseMediaRefs('[{"kind":"image","url":"/api/files/../../etc/passwd"}]')).toEqual([]);
    });

    /** @scenario "a reference to anywhere but our own file route is refused" */
    it("refuses a kind outside the rendered vocabulary", () => {
      expect(parseMediaRefs('[{"kind":"script","url":"/api/files/proj_1/x"}]')).toEqual([]);
    });

    /** @scenario "a reference to anywhere but our own file route is refused" */
    it("drops an unrecognised role to no role rather than hiding the reference", () => {
      expect(
        parseMediaRefs('[{"kind":"image","url":"/api/files/proj_1/x","role":"root"}]'),
      ).toEqual([{ kind: "image", url: "/api/files/proj_1/x" }]);
    });
  });
});

describe("given more distinct media than a summary strip shows", () => {
  describe("when the references are collected and merged", () => {
    /** @scenario "the strips never grow past the preview budget" */
    it("keeps four and no more", () => {
      expect(MAX_TRACE_MEDIA_REFS).toBe(4);

      const many = Array.from({ length: 9 }, (_, index) => ({
        type: "image_url",
        image_url: { url: `/api/files/proj_1/img_${index}` },
      }));
      const refs = collectMediaRefs(many);

      expect(refs).toHaveLength(4);
      expect(refs.map((ref) => ref.url)).toEqual([
        "/api/files/proj_1/img_0",
        "/api/files/proj_1/img_1",
        "/api/files/proj_1/img_2",
        "/api/files/proj_1/img_3",
      ]);
    });

    /** @scenario "the strips never grow past the preview budget" */
    it("puts the winning span's media at the front and dedupes by address", () => {
      const existing: TraceMediaRef[] = [
        { kind: "image", url: "/api/files/proj_1/old" },
        { kind: "image", url: "/api/files/proj_1/shared" },
      ];
      const incoming: TraceMediaRef[] = [
        { kind: "image", url: "/api/files/proj_1/new" },
        { kind: "image", url: "/api/files/proj_1/shared" },
      ];

      expect(mergeMediaRefs({ existing, incoming, precedence: "prepend" })).toEqual([
        { kind: "image", url: "/api/files/proj_1/new" },
        { kind: "image", url: "/api/files/proj_1/shared" },
        { kind: "image", url: "/api/files/proj_1/old" },
      ]);
      expect(mergeMediaRefs({ existing, incoming, precedence: "append" })).toEqual([
        { kind: "image", url: "/api/files/proj_1/old" },
        { kind: "image", url: "/api/files/proj_1/shared" },
        { kind: "image", url: "/api/files/proj_1/new" },
      ]);
    });
  });
});

describe("given references recorded under different chat roles", () => {
  describe("when each side of the summary asks which references belong to it", () => {
    /** @scenario "the agent's reply and the caller's media land on different strips" */
    it("puts the assistant on the output side and everything else on the input side", () => {
      expect(mediaRoleBelongsToSide("assistant", "output")).toBe(true);
      expect(mediaRoleBelongsToSide("assistant", "input")).toBe(false);
      expect(mediaRoleBelongsToSide("user", "input")).toBe(true);
      expect(mediaRoleBelongsToSide("user", "output")).toBe(false);
      expect(mediaRoleBelongsToSide("tool", "input")).toBe(true);
      expect(mediaRoleBelongsToSide("system", "input")).toBe(true);
    });

    /** @scenario "the agent's reply and the caller's media land on different strips" */
    it("never drops a roleless reference from both sides", () => {
      const roleless: TraceMediaRef = { kind: "image", url: "/api/files/proj_1/x" };

      expect(mediaRefBelongsToSide(roleless, "input")).toBe(true);
      expect(mediaRefBelongsToSide(roleless, "output")).toBe(true);
    });
  });
});

describe("given a raw realtime audio turn the packaged walk cannot wrap", () => {
  describe("when the walk and the reference collection run", () => {
    /**
     * The one deliberate difference from the application's walk: it wraps raw
     * PCM into a playable WAV data URI, which needs `Buffer`/`atob`, and this
     * package names neither runtime. The difference cannot be seen through
     * reference collection, because an inline `data:` source is never a
     * reference on either side.
     *
     * @scenario "a reference to anywhere but our own file route is refused" */
    it("produces no reference, which is what the application produces too", () => {
      const rawTurn = {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: "AAAAAAAAAAA=", format: "pcm16" },
          },
        ],
      };

      expect(collectAnnotatedMediaParts(rawTurn)).toEqual([]);
      expect(collectMediaRefs(rawTurn)).toEqual([]);
    });
  });
});
