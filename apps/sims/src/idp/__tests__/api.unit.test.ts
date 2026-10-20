import { afterEach, describe, expect, it, vi } from "vitest";

import { request, signInSchema, tenantSchema } from "../api.ts";

const respond = ({ body, status = 200 }: { body: string; status?: number }) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe("request", () => {
  it("hands back a refusal exactly as the simulator worded it", async () => {
    respond({
      status: 400,
      body: JSON.stringify({
        title: "Nothing to change",
        detail: "A churn round needs…",
        hint: "Put a number in.",
      }),
    });
    const answer = await request({
      path: "/api/t/1/churn",
      method: "POST",
      body: {},
      schema: signInSchema,
    });
    expect(answer).toEqual({
      ok: false,
      refusal: {
        title: "Nothing to change",
        detail: "A churn round needs…",
        hint: "Put a number in.",
      },
    });
  });

  it("turns an answer it cannot read into a refusal naming the status", async () => {
    respond({ status: 500, body: "could not persist IdP changes" });
    const answer = await request({ path: "/api/t/1", schema: tenantSchema });
    expect(answer).toMatchObject({ ok: false, refusal: { title: "The simulator answered 500" } });
  });

  it("reads Go's null lists as empty ones", async () => {
    respond({
      body: JSON.stringify({ tenantId: 1, domain: "acme1.test", refusal: null, users: null }),
    });
    const answer = await request({ path: "/api/t/1/sign-in", schema: signInSchema });
    expect(answer).toEqual({
      ok: true,
      data: { tenantId: 1, domain: "acme1.test", refusal: null, users: [] },
    });
  });

  it("says when the simulator is not there at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const answer = await request({ path: "/api/tenants", schema: signInSchema });
    expect(answer).toMatchObject({ ok: false, refusal: { title: "The simulator did not answer" } });
  });
});
