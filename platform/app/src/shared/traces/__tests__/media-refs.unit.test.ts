/**
 * @vitest-environment node
 *
 * Unit tests for the compact trace-level media refs
 * (specs/traces-v2/media-rendering.feature — the trace list and drawer
 * summary render from fold-derived refs, not from span payloads).
 */
import { describe, expect, it } from "vitest";
import {
  collectMediaRefs,
  MAX_TRACE_MEDIA_REFS,
  mediaRefBelongsToSide,
  mergeMediaRefs,
  parseMediaRefs,
  serializeMediaRefList,
} from "../media-refs";

/** The fold's two steps in one call: walk a span payload, then serialize it. */
const serializeMediaRefs = (value: unknown) =>
  serializeMediaRefList(collectMediaRefs(value));

describe("collectMediaRefs", () => {
  describe("given a winning span IO with externalized media", () => {
    it("collects url refs for images, audio, and named attachments", () => {
      const value = [
        {
          role: "user",
          content: [
            { type: "text", text: "look at this" },
            { type: "image_url", image_url: { url: "/api/files/p1/i1" } },
            {
              type: "input_audio",
              input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
            },
            {
              type: "binary",
              mimeType: "application/pdf",
              url: "/api/files/p1/f1",
              filename: "report.pdf",
            },
          ],
        },
      ];

      expect(collectMediaRefs(value)).toEqual([
        { kind: "image", url: "/api/files/p1/i1", role: "user" },
        { kind: "audio", url: "/api/files/p1/a1", role: "user" },
        {
          kind: "file",
          url: "/api/files/p1/f1",
          filename: "report.pdf",
          mimeType: "application/pdf",
          role: "user",
        },
      ]);
    });
  });

  describe("given one recording reachable through two paths in the payload", () => {
    /** @scenario One recording reachable through two paths collapses to one ref */
    it("records it once", () => {
      const audio = {
        type: "input_audio",
        input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
      };
      const value = [
        {
          role: "user",
          // The same part reached twice: once as message content, once through
          // a mirrored field an SDK carries alongside it.
          content: [audio],
          parts: [audio],
        },
      ];

      expect(collectMediaRefs(value)).toEqual([
        { kind: "audio", url: "/api/files/p1/a1", role: "user" },
      ]);
    });

    it("keeps the first role recorded when the same url arrives under two roles", () => {
      const value = [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "input_audio",
              input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
            },
          ],
        },
      ];

      expect(collectMediaRefs(value)).toEqual([
        { kind: "audio", url: "/api/files/p1/a1", role: "user" },
      ]);
    });
  });

  describe("given inline base64 media that was never externalized", () => {
    it("keeps refs url-only so the summary never re-bloats", () => {
      const value = [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "application/pdf",
              data: "QUJD",
            },
          ],
        },
      ];
      expect(collectMediaRefs(value)).toEqual([]);
    });
  });

  describe("given more media than the cap", () => {
    it("keeps at most the cap", () => {
      const parts = Array.from({ length: 10 }, (_, i) => ({
        type: "image_url",
        image_url: { url: `/api/files/p1/i${i}` },
      }));
      const refs = collectMediaRefs([{ role: "user", content: parts }]);
      expect(refs).toHaveLength(MAX_TRACE_MEDIA_REFS);
    });

    it("stamps the role on every ref it keeps under the cap", () => {
      const audioPart = (i: number) => ({
        type: "input_audio",
        input_audio: { url: `/api/files/p1/a${i}`, mimeType: "audio/wav" },
      });
      const refs = collectMediaRefs([
        { role: "user", content: [audioPart(0), audioPart(1)] },
        {
          role: "assistant",
          content: [audioPart(2), audioPart(3), audioPart(4)],
        },
      ]);

      expect(refs).toHaveLength(MAX_TRACE_MEDIA_REFS);
      expect(refs.map((ref) => ref.role)).toEqual([
        "user",
        "user",
        "assistant",
        "assistant",
      ]);
    });
  });

  describe("given a voice turn whose transcript holds both sides", () => {
    /** @scenario "A media ref remembers the role of the message it came from" */
    it("marks each recording with the role of its own message", () => {
      const refs = collectMediaRefs([
        {
          role: "user",
          content: [
            { type: "text", text: "ACME Freight dispatch, hello?" },
            {
              type: "input_audio",
              input_audio: {
                url: "/api/files/p1/spoken",
                mimeType: "audio/wav",
              },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Good afternoon, how can I help?" },
            {
              type: "input_audio",
              input_audio: {
                url: "/api/files/p1/reply",
                mimeType: "audio/wav",
              },
            },
          ],
        },
      ]);

      expect(refs).toEqual([
        { kind: "audio", url: "/api/files/p1/spoken", role: "user" },
        { kind: "audio", url: "/api/files/p1/reply", role: "assistant" },
      ]);
    });

    /** @scenario "A media ref remembers the role of the message it came from" */
    it("keeps the role across a nested JSON-string hop", () => {
      const typedRaw = {
        type: "raw",
        value: JSON.stringify([
          {
            role: "assistant",
            content: JSON.stringify([
              {
                type: "input_audio",
                input_audio: {
                  url: "/api/files/p1/nested",
                  mimeType: "audio/wav",
                },
              },
            ]),
          },
        ]),
      };

      expect(collectMediaRefs(typedRaw)).toEqual([
        { kind: "audio", url: "/api/files/p1/nested", role: "assistant" },
      ]);
    });

    /** @scenario "A media ref remembers the role of the message it came from" */
    it("records no role for a part outside a message or under an unknown role", () => {
      const refs = collectMediaRefs([
        {
          role: "narrator",
          content: [{ type: "image_url", image_url: { url: "/api/files/p1/odd" } }],
        },
        { type: "image_url", image_url: { url: "/api/files/p1/bare" } },
      ]);

      expect(refs).toEqual([
        { kind: "image", url: "/api/files/p1/odd" },
        { kind: "image", url: "/api/files/p1/bare" },
      ]);
    });
  });
});

describe("mediaRefBelongsToSide", () => {
  describe("given refs from both sides of a voice turn", () => {
    it("keeps the caller's recording on input and the reply on output", () => {
      const spoken = {
        kind: "audio",
        url: "/api/files/p1/a",
        role: "user",
      } as const;
      const reply = {
        kind: "audio",
        url: "/api/files/p1/b",
        role: "assistant",
      } as const;

      expect(mediaRefBelongsToSide(spoken, "input")).toBe(true);
      expect(mediaRefBelongsToSide(spoken, "output")).toBe(false);
      expect(mediaRefBelongsToSide(reply, "input")).toBe(false);
      expect(mediaRefBelongsToSide(reply, "output")).toBe(true);
    });
  });

  describe("given a ref with no role, as traces ingested earlier carry", () => {
    it("keeps it on both sides so nothing stops rendering", () => {
      const ref = { kind: "audio", url: "/api/files/p1/a" } as const;

      expect(mediaRefBelongsToSide(ref, "input")).toBe(true);
      expect(mediaRefBelongsToSide(ref, "output")).toBe(true);
    });
  });

  describe("given media the caller sent that is not a plain user message", () => {
    it("keeps a system or tool part on the input side", () => {
      for (const role of ["system", "tool", "developer", "function"] as const) {
        expect(
          mediaRefBelongsToSide({ kind: "image", url: "/api/files/p1/x", role }, "input"),
        ).toBe(true);
      }
    });
  });
});

describe("mergeMediaRefs", () => {
  const imageRef = (id: string) =>
    ({ kind: "image", url: `/api/files/p1/${id}` }) as const;

  describe("when the incoming span won the trace's headline input", () => {
    /** @scenario The headline span's media is preferred over a child's */
    it("puts its media first", () => {
      expect(
        mergeMediaRefs({
          existing: [imageRef("child")],
          incoming: [imageRef("winner")],
          precedence: "prepend",
        }),
      ).toEqual([imageRef("winner"), imageRef("child")]);
    });
  });

  describe("when the incoming span did not win", () => {
    /** @scenario Media on a child span reaches the trace's refs */
    it("keeps its media behind what is already there", () => {
      expect(
        mergeMediaRefs({
          existing: [imageRef("winner")],
          incoming: [imageRef("child")],
          precedence: "append",
        }),
      ).toEqual([imageRef("winner"), imageRef("child")]);
    });
  });

  describe("when both sides carry the same stored object", () => {
    it("keeps one ref", () => {
      expect(
        mergeMediaRefs({
          existing: [imageRef("same")],
          incoming: [imageRef("same")],
          precedence: "append",
        }),
      ).toEqual([imageRef("same")]);
    });
  });

  describe("when the merged list would exceed the cap", () => {
    /** @scenario The refs stay capped however many spans carry media */
    it("stops at the cap", () => {
      const many = Array.from({ length: MAX_TRACE_MEDIA_REFS + 3 }, (_, i) =>
        imageRef(`i${i}`),
      );

      const merged = mergeMediaRefs({
        existing: many,
        incoming: [imageRef("late")],
        precedence: "append",
      });

      expect(merged).toHaveLength(MAX_TRACE_MEDIA_REFS);
      expect(merged).not.toContainEqual(imageRef("late"));
    });
  });
});

describe("serializeMediaRefs and parseMediaRefs", () => {
  it("round-trips through the reserved attribute value", () => {
    const value = [
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "/api/files/p1/i1" } }],
      },
    ];
    const serialized = serializeMediaRefs(value);
    expect(serialized).not.toBeNull();
    expect(parseMediaRefs(serialized)).toEqual([
      { kind: "image", url: "/api/files/p1/i1", role: "user" },
    ]);
  });

  it("serializes media-free values to null so the attribute is cleared", () => {
    expect(serializeMediaRefs([{ role: "user", content: "hello" }])).toBeNull();
  });

  it("parses garbage defensively to an empty list", () => {
    expect(parseMediaRefs("not json")).toEqual([]);
    expect(parseMediaRefs(`{"kind":"image"}`)).toEqual([]);
    expect(parseMediaRefs(`[{"kind":"nope","url":"/x"}]`)).toEqual([]);
    expect(parseMediaRefs(null)).toEqual([]);
  });

  it("round-trips the message role and drops one it does not recognize", () => {
    const serialized = serializeMediaRefs([
      {
        role: "assistant",
        content: [{ type: "image_url", image_url: { url: "/api/files/p1/i1" } }],
      },
    ]);
    expect(parseMediaRefs(serialized)).toEqual([
      { kind: "image", url: "/api/files/p1/i1", role: "assistant" },
    ]);

    expect(
      parseMediaRefs(`[{"kind":"image","url":"/api/files/p1/i1","role":"nope"}]`),
    ).toEqual([{ kind: "image", url: "/api/files/p1/i1" }]);
  });

  describe("given a crafted reserved attribute smuggling non-stored urls", () => {
    /** @scenario A scripted URL in span content never reaches an anchor or element */
    it("rejects every ref whose url is not a stored-objects reference", () => {
      const crafted = JSON.stringify([
        { kind: "file", url: "javascript:alert(1)" },
        { kind: "image", url: "https://attacker.example/beacon.png" },
        { kind: "audio", url: "//attacker.example/a.wav" },
        { kind: "file", url: "/api/files/../../auth/session" },
        { kind: "image", url: "/api/files/p1/legit" },
      ]);
      expect(parseMediaRefs(crafted)).toEqual([
        { kind: "image", url: "/api/files/p1/legit" },
      ]);
    });
  });

  describe("given span content declaring external media parts", () => {
    /** @scenario External http(s) media is not auto-mounted from collected content */
    it("never folds external urls into refs, for any part category", () => {
      const value = [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://cdn.example/i.png" },
            },
            {
              type: "binary",
              mimeType: "image/png",
              url: "https://attacker.example/beacon.png",
            },
            {
              type: "audio",
              source: { type: "url", value: "https://attacker.example/a.wav" },
            },
            {
              type: "video",
              source: { type: "url", value: "https://attacker.example/v.mp4" },
            },
          ],
        },
      ];
      expect(collectMediaRefs(value)).toEqual([]);
    });
  });
});
