import { describe, expect, it } from "vitest";
import { agentHasDevTunnel } from "../src/model/agent-dev-tunnel";

describe("agentHasDevTunnel", () => {
  it("recognizes only HTTP agents carrying the CLI marker", () => {
    expect(agentHasDevTunnel({ type: "http", config: { devTunnel: {} } })).toBe(true);
    expect(agentHasDevTunnel({ type: "code", config: { devTunnel: {} } })).toBe(false);
    expect(agentHasDevTunnel({ type: "http", config: {} })).toBe(false);
  });
});
