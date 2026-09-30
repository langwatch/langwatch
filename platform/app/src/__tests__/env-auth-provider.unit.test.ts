import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfiguredAuthProvider } from "../env-create.mjs";

describe("the configured auth provider env", () => {
  const saved = {
    AUTH_PROVIDER: process.env.AUTH_PROVIDER,
    NEXTAUTH_PROVIDER: process.env.NEXTAUTH_PROVIDER,
  };

  beforeEach(() => {
    delete process.env.AUTH_PROVIDER;
    delete process.env.NEXTAUTH_PROVIDER;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.restoreAllMocks();
  });

  /** @scenario "The provider setting answers to its modern name" */
  it("reads AUTH_PROVIDER without a word of complaint", () => {
    process.env.AUTH_PROVIDER = "auth0";

    expect(resolveConfiguredAuthProvider()).toBe("auth0");
    expect(console.warn).not.toHaveBeenCalled();
  });

  /** @scenario "The provider setting answers to its modern name" */
  it("keeps a deployment on the deprecated name working, and says so once", () => {
    process.env.NEXTAUTH_PROVIDER = "auth0";

    expect(resolveConfiguredAuthProvider()).toBe("auth0");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("NEXTAUTH_PROVIDER is deprecated"),
    );
  });

  /** @scenario "The provider setting answers to its modern name" */
  it("lets the modern name win when both are set", () => {
    process.env.AUTH_PROVIDER = "okta";
    process.env.NEXTAUTH_PROVIDER = "auth0";

    expect(resolveConfiguredAuthProvider()).toBe("okta");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("defaults to email mode when neither is set", () => {
    expect(resolveConfiguredAuthProvider()).toBe("email");
  });
});
