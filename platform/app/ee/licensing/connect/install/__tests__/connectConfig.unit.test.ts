/**
 * What the install reads from its deployment configuration, and what it reads
 * when nothing is set.
 *
 * @see ../connectConfig.ts
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readConnectConfig } from "../connectConfig";

const env = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("~/env.mjs", () => ({ env }));

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
});

describe("given a deployment that sets no Connect variable", () => {
  describe("when the install reads its configuration", () => {
    /** @scenario "Connect disabled in the deployment configuration sends nothing" */
    it("reports Connect as off, with no endpoint to call", () => {
      expect(readConnectConfig()).toEqual({ enabled: false });
    });
  });
});

describe("given a deployment with Connect switched on and nothing else set", () => {
  describe("when the install reads its configuration", () => {
    it("takes the published endpoints as the defaults", () => {
      env.LANGWATCH_CONNECT_ENABLED = true;

      expect(readConnectConfig()).toEqual({
        enabled: true,
        gatewayEndpoint: "https://gateway.langwatch.ai",
        licenseEndpoint: "https://connect.langwatch.ai",
      });
    });

    it("names no instance id, so the organization id is what identifies it", () => {
      env.LANGWATCH_CONNECT_ENABLED = true;

      const config = readConnectConfig();

      expect(config.enabled && config.instanceIdOverride).toBeUndefined();
    });
  });
});

describe("given a deployment that names its own endpoints and instance", () => {
  describe("when the install reads its configuration", () => {
    it("takes all three over the defaults", () => {
      env.LANGWATCH_CONNECT_ENABLED = true;
      env.LANGWATCH_CONNECT_GATEWAY_ENDPOINT = "https://gateway.example.test";
      env.LANGWATCH_CONNECT_LICENSE_ENDPOINT = "https://connect.example.test";
      env.LANGWATCH_CONNECT_INSTANCE_ID = "  instance-of-record  ";

      expect(readConnectConfig()).toEqual({
        enabled: true,
        gatewayEndpoint: "https://gateway.example.test",
        licenseEndpoint: "https://connect.example.test",
        instanceIdOverride: "instance-of-record",
      });
    });
  });
});

describe("given a deployment with endpoints set but Connect switched off", () => {
  describe("when the install reads its configuration", () => {
    it("still reports Connect as off", () => {
      env.LANGWATCH_CONNECT_GATEWAY_ENDPOINT = "https://gateway.example.test";
      env.LANGWATCH_CONNECT_INSTANCE_ID = "instance-of-record";

      expect(readConnectConfig()).toEqual({ enabled: false });
    });
  });
});
