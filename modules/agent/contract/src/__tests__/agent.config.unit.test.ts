import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { agentServerConfig } from "../agent.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "agent", config: agentServerConfig }], environment }).agent;

describe("agent server configuration", () => {
  describe("given a deployment names no replica count", () => {
    /** @scenario "A feature's defaults are the values a deployment already runs on" */
    it("reads one replica and no payload cap of its own", () => {
      expect(read({})).toEqual({ replicaCount: 1, relayMaxPayloadMb: undefined });
    });
  });

  describe("given a replica count that is not a positive whole number", () => {
    /** @scenario "An unreadable switch is refused instead of read as off" */
    it("refuses the boot", () => {
      expect(() => read({ LANGWATCH_APP_REPLICAS: "0" })).toThrow(ConfigParseError);
    });
  });
});
