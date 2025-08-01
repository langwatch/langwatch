import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

describe("client config", () => {
  let client: any;

  beforeEach(async () => {
    // Mock environment variables before importing the client module
    vi.stubEnv('LANGWATCH_API_KEY', undefined);
    vi.stubEnv('LANGWATCH_ENDPOINT', undefined);

    // Reset modules to ensure fresh import after env stubbing
    vi.resetModules();

    // Dynamically import the client module
    client = await import("../client.js");

    // Reset config before each test
    client.setConfig({
      apiKey: "",
      endpoint: void 0,
      disableOpenTelemetryAutomaticSetup: false,
      disableAutomaticInputCapture: false,
      disableAutomaticOutputCapture: false,
    });
  });

  afterAll(() => {
    // Restore original environment
    vi.unstubAllEnvs();
  });

  it("should use default values if nothing is set", () => {
    expect(client.getApiKey()).toBe("");
    expect(client.getEndpoint()).toBe("https://app.langwatch.ai");
    expect(client.canAutomaticallyCaptureInput()).toBe(true);
    expect(client.canAutomaticallyCaptureOutput()).toBe(true);
  });

  it("should use env vars if set", () => {
    process.env.LANGWATCH_API_KEY = "env-key";
    process.env.LANGWATCH_ENDPOINT = "https://env.endpoint";

    client.setConfig({});

    expect(client.getApiKey()).toBe("env-key");
    expect(client.getEndpoint()).toBe("https://env.endpoint");
  });

  it("should update config with setConfig", () => {
    client.setConfig({
      apiKey: "test-key",
      endpoint: "https://test.endpoint",
      disableAutomaticInputCapture: true,
      disableAutomaticOutputCapture: true,
    });
    expect(client.getApiKey()).toBe("test-key");
    expect(client.getEndpoint()).toBe("https://test.endpoint");
    expect(client.canAutomaticallyCaptureInput()).toBe(false);
    expect(client.canAutomaticallyCaptureOutput()).toBe(false);
  });

  it("should not override values if undefined is passed", () => {
    client.setConfig({
      apiKey: "first-key",
      endpoint: "https://first.endpoint",
    });
    client.setConfig({ apiKey: undefined, endpoint: undefined });
    expect(client.getApiKey()).toBe("first-key");
    expect(client.getEndpoint()).toBe("https://first.endpoint");
  });
});
