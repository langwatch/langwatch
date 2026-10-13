import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { SimFetchError, simFetch } from "../sim-fetch.ts";

const schema = z.object({ calls: z.array(z.object({ model: z.string() })) });

const answer = ({ status, body }: { status: number; body: string }) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe("simFetch", () => {
  describe("when the simulator answers 200", () => {
    /** @scenario "A simulator's answer is parsed, and its refusal is kept in its words" */
    it("parses the body with the schema", async () => {
      answer({ status: 200, body: JSON.stringify({ calls: [{ model: "gpt-5" }] }) });

      await expect(simFetch({ path: "/_sim/api/calls", schema })).resolves.toEqual({
        calls: [{ model: "gpt-5" }],
      });
      expect(fetch).toHaveBeenCalledWith("/_sim/api/calls", expect.anything());
    });

    it("refuses a body the schema does not describe", async () => {
      answer({ status: 200, body: JSON.stringify({ calls: "nope" }) });

      await expect(simFetch({ path: "/_sim/api/calls", schema })).rejects.toThrow(/./);
    });
  });

  describe("when the simulator refuses", () => {
    /** @scenario "A simulator's answer is parsed, and its refusal is kept in its words" */
    it("throws a SimFetchError with the status and the simulator's message", async () => {
      answer({ status: 404, body: JSON.stringify({ error: "no bucket named uploads" }) });

      const caught = await simFetch({ path: "/_sim/api/objects", schema }).catch(
        (error: unknown) => error,
      );

      expect(caught).toBeInstanceOf(SimFetchError);
      expect(caught).toMatchObject({ status: 404, message: "no bucket named uploads" });
    });

    it("reads an OpenAI-shaped refusal", async () => {
      answer({ status: 400, body: JSON.stringify({ error: { message: "bad seed" } }) });

      await expect(simFetch({ path: "/_sim/api/settings", schema })).rejects.toMatchObject({
        status: 400,
        message: "bad seed",
      });
    });

    it("says the request failed when the body is not the simulator's JSON", async () => {
      answer({ status: 502, body: "<html>bad gateway</html>" });

      await expect(simFetch({ path: "/_sim/api/calls", schema })).rejects.toMatchObject({
        status: 502,
        message: "Request failed (502). Please retry.",
      });
    });
  });
});
