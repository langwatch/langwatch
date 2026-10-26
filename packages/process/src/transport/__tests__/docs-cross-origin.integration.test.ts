/**
 * The API surface answers the docs playground's cross-origin REST calls (ADR-185).
 * @see modules/api-key/specs/docs-session-keys.feature
 */
import { describe, expect, it } from "vitest";

import { composeApiApplication } from "../api-surface.ts";

const REGISTERED = "https://langwatch.ai";
const api = composeApiApplication({ docsOrigins: [REGISTERED, "https://app.example.com"] });

function preflight({ origin, path = "/api/v1/traces/search" }: { origin: string; path?: string }) {
  return api.request(path, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-auth-token, content-type",
    },
  });
}

describe("given a registered docs origin and an unregistered origin", () => {
  /** @scenario "The API answers cross-origin calls only from registered docs origins" */
  it("allows the registered origin's preflight, without credentials", async () => {
    const answer = await preflight({ origin: REGISTERED });

    expect(answer.status).toBe(204);
    expect(answer.headers.get("access-control-allow-origin")).toBe(REGISTERED);
    expect(answer.headers.get("access-control-allow-headers")).toBe("X-Auth-Token, Content-Type");
    expect(answer.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(answer.headers.get("access-control-allow-credentials")).toBeNull();
    expect(answer.headers.get("vary")).toContain("Origin");
  });

  /** @scenario "The API answers cross-origin calls only from registered docs origins" */
  it("gives an unregistered origin no CORS allowance, however close its name", async () => {
    for (const origin of [
      "https://evil.example",
      "https://langwatch.ai.evil.example",
      "https://docs.langwatch.ai",
      "http://langwatch.ai",
    ]) {
      const answer = await preflight({ origin });

      expect(answer.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  /** @scenario "The API answers cross-origin calls only from registered docs origins" */
  it("marks a registered origin's response readable and varies it by origin", async () => {
    const answer = await api.request("/api/nowhere", { headers: { Origin: REGISTERED } });

    expect(answer.headers.get("access-control-allow-origin")).toBe(REGISTERED);
    expect(answer.headers.get("access-control-allow-credentials")).toBeNull();
    expect(answer.headers.get("vary")).toContain("Origin");
  });

  it("never opens the session-cookie lanes to another origin", async () => {
    for (const path of ["/api/trpc/apiKey.list", "/api/sse/x", "/api/auth/session"]) {
      const answer = await preflight({ origin: REGISTERED, path });

      expect(answer.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});
