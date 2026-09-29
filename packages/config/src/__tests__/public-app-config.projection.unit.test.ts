import { describe, expect, it } from "vitest";

import {
  LOCAL_GATEWAY_URL,
  resolveGatewayBaseUrl,
  resolvePublicAppConfig,
  SAAS_GATEWAY_URL,
} from "../public-app-config.projection.ts";

describe("public application configuration projection", () => {
  it("maps declared private deployment inputs and leaves credentials behind", () => {
    // Mail availability is the notification member's answer, handed in as a boolean.
    const config = resolvePublicAppConfig(
      {
        BASE_HOST: "https://app.example.test",
        NODE_ENV: "production",
        IS_SAAS: "false",
        LW_GATEWAY_PUBLIC_URL: "https://gateway.example.test",
        RUM_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test",
        NEXTAUTH_SECRET: "must-not-cross-the-browser-boundary",
      },
      { mailAvailable: true },
    );

    expect(config).toMatchObject({
      process: {
        appBaseUrl: "https://app.example.test",
        deployment: "self-hosted",
      },
      rum: { enabled: true, sampleRatio: 1 },
      gateway: { gatewayBaseUrl: "https://gateway.example.test" },
      notification: { email: true },
    });
    expect(JSON.stringify(config)).not.toContain("must-not-cross-the-browser-boundary");
  });

  it("hands the browser an ops slice with Cloud admin off, which the ops schema requires", () => {
    const config = resolvePublicAppConfig({
      BASE_HOST: "https://app.example.test",
      NODE_ENV: "production",
    });

    expect(config.ops).toEqual({ cloudOps: false });
  });

  it("hands the browser HIDE_DEV_INDICATOR only when it is switched on", () => {
    const base = { BASE_HOST: "https://app.example.test", NODE_ENV: "development" };
    const processSlice = (source: Record<string, string>) => resolvePublicAppConfig(source).process;

    expect(processSlice({ ...base, HIDE_DEV_INDICATOR: "1" })).toMatchObject({
      hideDevIndicator: true,
    });
    expect(processSlice({ ...base, HIDE_DEV_INDICATOR: "true" })).toMatchObject({
      hideDevIndicator: true,
    });
    expect(processSlice({ ...base, HIDE_DEV_INDICATOR: "false" })).not.toHaveProperty(
      "hideDevIndicator",
    );
    expect(processSlice(base)).not.toHaveProperty("hideDevIndicator");
  });

  /** @scenario "the browser is handed the badge label only when the deployment names one" */
  it("hands the browser DEV_INDICATOR_LABEL only when it names a stack", () => {
    const base = { BASE_HOST: "https://app.example.test", NODE_ENV: "development" };
    const processSlice = (source: Record<string, string>) => resolvePublicAppConfig(source).process;

    expect(
      processSlice({ ...base, DEV_INDICATOR_LABEL: "feat-strict-feature-layout-v0" }),
    ).toMatchObject({ devIndicatorLabel: "feat-strict-feature-layout-v0" });
    expect(processSlice({ ...base, DEV_INDICATOR_LABEL: "  " })).not.toHaveProperty(
      "devIndicatorLabel",
    );
    expect(processSlice(base)).not.toHaveProperty("devIndicatorLabel");
  });

  describe("given the passkey switch the dev server projects for auth", () => {
    const base = { BASE_HOST: "https://app.example.test", NODE_ENV: "development" };
    const passkeys = (source: Record<string, string>) =>
      resolvePublicAppConfig({ ...base, ...source }).auth?.passkeys;

    /** @scenario "A passkey is offered on every deployment, not on some of them" */
    it("offers passkeys unless the operator turned them off, as auth's own switch does", () => {
      expect(passkeys({})).toBe(true);
      expect(passkeys({ PASSKEYS_ENABLED: "on" })).toBe(true);
      expect(passkeys({ PASSKEYS_ENABLED: "off" })).toBe(false);
    });
  });

  it("retains the gateway public-url, legacy-url, and deployment-default precedence", () => {
    expect(
      resolveGatewayBaseUrl({
        LW_GATEWAY_PUBLIC_URL: "https://public.example.test",
        LW_GATEWAY_BASE_URL: "https://legacy.example.test",
        IS_SAAS: true,
      }),
    ).toBe("https://public.example.test");
  });

  it("falls back to the legacy gateway url when no public url is configured", () => {
    expect(
      resolveGatewayBaseUrl({
        LW_GATEWAY_BASE_URL: "https://legacy.example.test",
        IS_SAAS: true,
      }),
    ).toBe("https://legacy.example.test");
  });

  it("resolves the canonical .ai gateway host for SaaS", () => {
    const resolved = resolveGatewayBaseUrl({ IS_SAAS: true });

    expect(resolved).toBe("https://gateway.langwatch.ai");
    // The SaaS gateway is a .ai host. A .com here is a real outage, not a typo.
    expect(resolved).not.toContain(".com");
    expect(SAAS_GATEWAY_URL).toBe("https://gateway.langwatch.ai");
  });

  it("resolves the local Go gateway port for self-hosted deployments", () => {
    expect(resolveGatewayBaseUrl({ IS_SAAS: false })).toBe(LOCAL_GATEWAY_URL);
  });
});
