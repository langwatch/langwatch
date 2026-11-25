import { describe, expect, it } from "vitest";

import { httpAgentConfigSchema } from "../config/http.ts";

describe("HTTP agent dev tunnel marker", () => {
  /** @scenario "An HTTP agent's dev tunnel marker keeps its heartbeat" */
  it("keeps heartbeatAt on parse", () => {
    const devTunnel = {
      previousUrl: "https://staging.example.com/agent",
      connectedAt: "2026-09-30T09:00:00Z",
      heartbeatAt: "2026-09-30T09:01:00Z",
    };

    const parsed = httpAgentConfigSchema.parse({ url: "http://localhost:1234", devTunnel });

    expect(parsed.devTunnel).toEqual(devTunnel);
  });
});
