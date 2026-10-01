import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";

import { createUiFeatureApiClient } from "../transport.ts";

/**
 * One request per call against tRPC's own fetch handler, the one `/api/trpc`
 * runs: a fast answer is never held behind a slow one.
 */

const ENDPOINT = "http://ui.test/api/trpc";

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString();
}

function serverOver({ slowAnswer }: { slowAnswer: Promise<string> }) {
  const t = initTRPC.create();
  const router = t.router({
    fast: t.procedure.query(() => ({ at: new Date("2026-09-30T12:00:00.000Z") })),
    slow: t.procedure.query(() => slowAnswer),
    refused: t.procedure.query(() => {
      throw new TRPCError({ code: "FORBIDDEN" });
    }),
  });
  const requests: string[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(requestUrl(input));
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request(requestUrl(input), init),
      router,
      createContext: () => ({}),
    });
  }) as typeof globalThis.fetch;

  return { client: createUiFeatureApiClient({ url: ENDPOINT, fetch }), requests };
}

describe("given a fast read and a slow one asked in the same tick", () => {
  describe("when both are asked together", () => {
    it("answers the fast one while the slow one is still running, each on its own request", async () => {
      let release: (value: string) => void = () => undefined;
      const slowAnswer = new Promise<string>((resolve) => {
        release = resolve;
      });
      const { client, requests } = serverOver({ slowAnswer });
      let slowSettled = false;

      const slow = client.query("slow", undefined).then((value) => {
        slowSettled = true;
        return value;
      });
      const fast = await client.query("fast", undefined);

      expect(fast).toEqual({ at: "2026-09-30T12:00:00.000Z" });
      expect(slowSettled).toBe(false);
      release("done");
      expect(await slow).toBe("done");
      expect(requests).toHaveLength(2);
      expect(requests.some((request) => request.includes("batch="))).toBe(false);
    });
  });
});

describe("given two reads where one is refused", () => {
  it("fails that read with its own status and still answers the other", async () => {
    const { client } = serverOver({ slowAnswer: Promise.resolve("done") });

    const [refused, answered] = await Promise.allSettled([
      client.query("refused", undefined),
      client.query("slow", undefined),
    ]);

    expect(answered).toEqual({ status: "fulfilled", value: "done" });
    expect(refused.status).toBe("rejected");
    const reason: unknown = refused.status === "rejected" ? refused.reason : undefined;
    expect(reason).toMatchObject({ data: { httpStatus: 403, code: "FORBIDDEN" } });
  });
});
