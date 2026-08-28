import { describe, expect, it } from "vitest";
import { resolveApiConfig } from "../src/platform/config/api.config";

describe("API process configuration", () => {
  it("parses the listener and drain settings once at executable composition", () => {
    expect(
      resolveApiConfig({
        ENVIRONMENT: "production",
        API_HOST: "127.0.0.1",
        API_PORT: "6560",
        API_HTTP_DRAIN_GRACE_MS: "9000",
      }),
    ).toEqual({
      environment: "production",
      host: "127.0.0.1",
      port: 6560,
      httpDrainGraceMs: 9000,
    });
  });

  it("rejects invalid executable ports before a listener is constructed", () => {
    expect(() => resolveApiConfig({ API_PORT: "0" })).toThrow("Invalid api configuration");
  });
});
