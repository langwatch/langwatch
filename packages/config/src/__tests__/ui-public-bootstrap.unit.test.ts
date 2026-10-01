import { ConfigParseError } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { resolveUiPublicBootstrap } from "../public-app-config.projection.ts";

describe("UI public bootstrap", () => {
  it("parses one UI process projection and returns only browser-safe values", () => {
    // No credential reaches the projection (ADR-132); it is handed the member's boolean.
    const boot = resolveUiPublicBootstrap(
      {
        BASE_HOST: "https://app.example.test",
        NODE_ENV: "production",
        UI_PROCESS_ROLE: "ui",
        NEXTAUTH_SECRET: "must-not-cross-the-browser-boundary",
      },
      { mailAvailable: true },
    );

    expect(boot).toEqual({
      processRole: "ui",
      publicConfig: expect.objectContaining({
        process: expect.objectContaining({
          appBaseUrl: "https://app.example.test",
          mode: "production",
        }),
        notification: { email: true },
      }),
    });
    expect(JSON.stringify(boot.publicConfig)).not.toContain("must-not-cross-the-browser-boundary");
  });

  it("fails before browser boot when the required public host is missing", () => {
    expect(() => resolveUiPublicBootstrap({ NODE_ENV: "production" })).toThrow(ConfigParseError);
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
