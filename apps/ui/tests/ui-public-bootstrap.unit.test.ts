import { describe, expect, it } from "vitest";
import { InvalidRuntimeConfigError } from "@langwatch/config";
import { resolveUiPublicBootstrap } from "../src/behavior/public-config.projection";

describe("UI public bootstrap", () => {
  it("parses one UI process projection and returns only browser-safe values", () => {
    const boot = resolveUiPublicBootstrap({
      BASE_HOST: "https://app.example.test",
      NODE_ENV: "production",
      UI_PROCESS_ROLE: "ui",
      RESEND_API_KEY: "private-capability-input",
      EMAIL_PROVIDER: "resend",
      NEXTAUTH_SECRET: "must-not-cross-the-browser-boundary",
    });

    expect(boot).toEqual({
      processRole: "ui",
      publicConfig: expect.objectContaining({
        appBaseUrl: "https://app.example.test",
        mode: "production",
        capabilities: expect.objectContaining({ email: true }),
      }),
    });
    expect(boot.publicConfig).not.toHaveProperty("NEXTAUTH_SECRET");
    expect(boot.publicConfig).not.toHaveProperty("RESEND_API_KEY");
  });

  it("fails before browser boot when the required public host is missing", () => {
    expect(() => resolveUiPublicBootstrap({ NODE_ENV: "production" })).toThrow(
      InvalidRuntimeConfigError,
    );
    expect(() => resolveUiPublicBootstrap({ NODE_ENV: "production" })).toThrow(
      /public.appBaseUrl/i,
    );
  });

  it("rejects a non-UI process role instead of booting a browser projection in that process", () => {
    expect(() =>
      resolveUiPublicBootstrap({
        BASE_HOST: "https://app.example.test",
        NODE_ENV: "production",
        UI_PROCESS_ROLE: "worker",
      }),
    ).toThrow(/processRole/i);
  });
});
