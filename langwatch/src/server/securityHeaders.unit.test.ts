import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "./securityHeaders";

describe("buildSecurityHeaders", () => {
  it("disables unused browser capabilities in production", () => {
    const headers = buildSecurityHeaders({
      dev: false,
      environment: {},
    });

    expect(headers["Permissions-Policy"]).toBe("geolocation=(), microphone=(), camera=(), payment=(), usb=()");
    expect(headers["Content-Security-Policy"]).toBeDefined();
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("keeps the capability restrictions on development responses", () => {
    const headers = buildSecurityHeaders({
      dev: true,
      environment: {},
    });

    expect(headers["Permissions-Policy"]).toBe("geolocation=(), microphone=(), camera=(), payment=(), usb=()");
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });
});
