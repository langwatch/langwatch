import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parsePublicRestInput } from "../public-rest-input.js";

describe("public REST input parsing", () => {
  it("keeps repeated GET query values as arrays while preserving scalar query values", async () => {
    const input = z.object({
      query: z.string(),
      tag: z.array(z.string()),
    });
    const app = new Hono().get("/search", async (context) => {
      const parsed = await parsePublicRestInput({
        context,
        maxInputBytes: 1_024,
        method: "get",
        params: void 0,
        schema: input,
      });
      return context.json(parsed);
    });

    const response = await app.request("/search?query=traces&tag=error&tag=llm");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: "traces",
      tag: ["error", "llm"],
    });
  });
  /**
   * @scenario "A chunked body past the cap is refused without being buffered"
   * @scenario "A body past the cap under a non-integer Content-Length is refused"
   */
  describe("given a body larger than the cap", () => {
    const CAP = 1_024;
    const CHUNK = 256;
    const CHUNKS = 100;

    function countedBody(): { body: ReadableStream<Uint8Array>; pulled: () => number } {
      let pulled = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled >= CHUNKS) {
            controller.close();
            return;
          }
          pulled += 1;
          controller.enqueue(new Uint8Array(CHUNK).fill(0x61));
        },
      });
      return { body, pulled: () => pulled };
    }

    async function post(headers: Record<string, string>) {
      const { body, pulled } = countedBody();
      const app = new Hono().post("/ingest", async (context) => {
        try {
          await parsePublicRestInput({
            context,
            maxInputBytes: CAP,
            method: "post",
            params: void 0,
            schema: z.object({ payload: z.string() }),
          });
        } catch (error) {
          return context.json({
            code: (error as { issues?: { code: string }[] }).issues?.[0]?.code,
          });
        }
        return context.json({ code: "accepted" });
      });

      const request = new Request("http://api.test/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
        // Node requires the half-duplex declaration for a streamed request body.
        duplex: "half",
      } as RequestInit);

      const response = await app.request(request);
      return { code: (await response.json()).code as string | undefined, pulled: pulled() };
    }

    describe("when the request is chunked and declares no length", () => {
      it("refuses it as too large and stops reading at the cap", async () => {
        const { code, pulled } = await post({ "transfer-encoding": "chunked" });

        expect(code).toBe("request_too_large");
        expect(pulled).toBeLessThanOrEqual(CAP / CHUNK + 2);
      });
    });

    describe("when the declared Content-Length is not a whole number", () => {
      it("refuses it as too large rather than skipping the check", async () => {
        const { code, pulled } = await post({ "content-length": "100, 5000000000" });

        expect(code).toBe("request_too_large");
        expect(pulled).toBeLessThanOrEqual(CAP / CHUNK + 2);
      });
    });
  });
});
