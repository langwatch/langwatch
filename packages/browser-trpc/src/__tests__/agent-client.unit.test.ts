import { describe, expect, it } from "vitest";

import { agentHasDevTunnel } from "../agent-client.ts";

describe("agentHasDevTunnel", () => {
  describe("given an http agent", () => {
    describe("when its configuration names a dev tunnel", () => {
      it("reports the tunnel", () => {
        expect(
          agentHasDevTunnel({ type: "http", config: { devTunnel: "https://tunnel.test" } }),
        ).toBe(true);
      });
    });

    describe("when its configuration names an empty dev tunnel", () => {
      it("reports no tunnel", () => {
        expect(agentHasDevTunnel({ type: "http", config: { devTunnel: "" } })).toBe(false);
      });
    });

    describe("when it carries no configuration at all", () => {
      it("reports no tunnel", () => {
        expect(agentHasDevTunnel({ type: "http" })).toBe(false);
      });
    });
  });

  describe("given an agent of another type", () => {
    describe("when its configuration names a dev tunnel", () => {
      it("reports no tunnel, because only http agents are tunnelled", () => {
        expect(
          agentHasDevTunnel({ type: "workflow", config: { devTunnel: "https://tunnel.test" } }),
        ).toBe(false);
      });
    });
  });
});
