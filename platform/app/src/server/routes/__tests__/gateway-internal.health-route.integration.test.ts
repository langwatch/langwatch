/**
 * @vitest-environment node
 *
 * GET /api/internal/gateway/health is the control-plane half of the
 * gateway's status-page health endpoint. The Go gateway's statusprobe
 * monitor calls this on its own clock and serves the cached verdict on
 * the public GET /health route (specs/ai-gateway/gateway-health.feature).
 *
 * Hits the real Hono app so the HMAC verifySecret chain is exercised
 * end-to-end: the probe must succeed only over the signed channel, since
 * proving the shared secret matches is the reason the probe exists.
 */
import { createHash, createHmac } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app } from "../gateway-internal";

const SECRET = "0123456789abcdef0123456789abcdef";
const PATH = "/api/internal/gateway/health";

function signedRequest(path: string, overrides?: { signature?: string }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update("").digest("hex");
  const canonical = `GET\n${path}\n${timestamp}\n${bodyHash}`;
  const signature =
    overrides?.signature ??
    createHmac("sha256", SECRET).update(canonical).digest("hex");
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: {
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
    },
  });
}

describe("GET /api/internal/gateway/health", () => {
  let previousSecret: string | undefined;

  beforeAll(() => {
    previousSecret = process.env.LW_GATEWAY_INTERNAL_SECRET;
    process.env.LW_GATEWAY_INTERNAL_SECRET = SECRET;
  });

  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.LW_GATEWAY_INTERNAL_SECRET;
    } else {
      process.env.LW_GATEWAY_INTERNAL_SECRET = previousSecret;
    }
  });

  /** @scenario "control plane answers the gateway's signed health probe" */
  it("returns 200 with a static ok body for a signed probe", async () => {
    const res = await app.request(signedRequest(PATH));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  /** @scenario "unsigned health probes to the control plane are rejected" */
  it("rejects a probe without signature headers", async () => {
    const res = await app.request(PATH, { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("rejects a probe with a wrong signature", async () => {
    const res = await app.request(
      signedRequest(PATH, { signature: "0".repeat(64) }),
    );
    expect(res.status).toBe(401);
  });
});
