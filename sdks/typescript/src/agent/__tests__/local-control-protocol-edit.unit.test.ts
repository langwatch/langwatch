/**
 * How a `local_edit` call reads off the wire: a replacement and an append both reach the CLI.
 * @see specs/langy/langy-local-control.feature
 */
import { describe, expect, it } from "vitest";

import { parsePlatformFrame } from "../local-control-protocol";

const editCall = (edits: unknown[]): string =>
  JSON.stringify({
    type: "call",
    protocol: 1,
    call: {
      callId: "langycall_1",
      conversationId: "langyconv_1",
      turnId: "langyturn_1",
      deadlineAt: 0,
      tool: "local_edit",
      params: { path: "requirements.txt", edits },
    },
  });

describe("parsePlatformFrame", () => {
  describe("given a local_edit call", () => {
    /** @scenario "An edit can append to the end of a file" */
    it("reads an entry that carries text to append", () => {
      const frame = parsePlatformFrame(editCall([{ append: "langwatch" }]));

      expect(frame).toMatchObject({
        type: "call",
        call: { tool: "local_edit", params: { edits: [{ append: "langwatch" }] } },
      });
    });

    it("reads a replacement next to an append", () => {
      const frame = parsePlatformFrame(
        editCall([{ oldText: "openai", newText: "openai>=1.40" }, { append: "langwatch" }]),
      );

      expect(frame).toMatchObject({
        call: {
          params: {
            edits: [{ oldText: "openai", newText: "openai>=1.40" }, { append: "langwatch" }],
          },
        },
      });
    });

    it("drops an entry that is neither a replacement nor an append", () => {
      expect(parsePlatformFrame(editCall([{ newText: "x" }]))).toBeNull();
    });
  });
});
