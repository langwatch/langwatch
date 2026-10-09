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
    it("permits Connect and takes the published endpoints as the defaults", () => {
      expect(readConnectConfig()).toEqual({
        permitted: true,
        gatewayEndpoint: "https://gateway.langwatch.ai",
        licenseEndpoint: "https://connect.langwatch.ai",
      });
    });

    it("names no instance id, so the minted one identifies the install", () => {
      expect(readConnectConfig().instanceIdOverride).toBeUndefined();
    });
  });
});

describe("given a deployment that names its own endpoints and instance", () => {
  describe("when the install reads its configuration", () => {
    it("takes all three over the defaults", () => {
      env.LANGWATCH_CONNECT_GATEWAY_ENDPOINT = "https://gateway.example.test";
      env.LANGWATCH_CONNECT_LICENSE_ENDPOINT = "https://connect.example.test";
      env.LANGWATCH_CONNECT_INSTANCE_ID = "  instance-of-record  ";

      expect(readConnectConfig()).toEqual({
        permitted: true,
        gatewayEndpoint: "https://gateway.example.test",
        licenseEndpoint: "https://connect.example.test",
        instanceIdOverride: "instance-of-record",
      });
    });
  });
});

describe("given an operator who switched Connect off for an audit", () => {
  describe("when the install reads its configuration", () => {
    /** @scenario "Connect disabled in the deployment configuration sends nothing" */
    it("refuses Connect although the endpoints are still named", () => {
      env.LANGWATCH_CONNECT_DISABLED = true;
      env.LANGWATCH_CONNECT_GATEWAY_ENDPOINT = "https://gateway.example.test";
      env.LANGWATCH_CONNECT_INSTANCE_ID = "instance-of-record";

      expect(readConnectConfig().permitted).toBe(false);
    });
  });
});
