import { describe, expect, it } from "vitest";
import { AppBootConfigService, InvalidAppBootConfigError } from "../config";

describe("AppBootConfigService", () => {
  it("resolves explicit boot settings without inspecting process.env", () => {
    const config = new AppBootConfigService().resolve({
      NODE_ENV: "development",
      PORT: "6560",
      WORKERS_IN_PROCESS: "1",
      UNRELATED_SECRET: "not part of app boot config",
    });

    expect(config).toEqual({
      nodeEnv: "development",
      environment: "local",
      port: 6560,
      apiPort: undefined,
      workersInProcess: true,
      developmentHttp2: false,
      developmentHttpsCertificatePath: undefined,
      developmentHttpsPrivateKeyPath: undefined,
      developmentCertificateDirectory: undefined,
      gatewaySecretsConfigured: false,
      trpcWebSocket: { allowedOrigins: [] },
    });
    expect(config).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("normalizes transport settings and rejects a partial TLS pair", () => {
    expect(
      new AppBootConfigService().resolve({
        NODE_ENV: "development",
        LANGWATCH_DEV_HTTP2: "1",
        LW_VIRTUAL_KEY_PEPPER: "a",
        LW_GATEWAY_INTERNAL_SECRET: "b",
        LW_GATEWAY_JWT_SECRET: "c",
      }),
    ).toMatchObject({
      developmentHttp2: true,
      gatewaySecretsConfigured: true,
    });

    expect(() =>
      new AppBootConfigService().resolve({
        NODE_ENV: "development",
        DEV_HTTPS_CERT: "/tmp/dev.pem",
      }),
    ).toThrow(InvalidAppBootConfigError);
  });

  it("reports invalid fields without echoing values", () => {
    let caught: unknown;
    try {
      new AppBootConfigService().resolve({
        NODE_ENV: "production",
        PORT: "secret-not-a-port",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidAppBootConfigError);
    expect(caught).toMatchObject({
      issues: [{ path: "port", code: "invalid_type" }],
    });
    expect(String(caught)).not.toContain("secret-not-a-port");
  });
});
