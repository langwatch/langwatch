/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { checkEntitlement } from "../middleware";

describe("checkEntitlement middleware", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("calls next() when entitlement is present", async () => {
    process.env.LICENSE_KEY = "LW-ENT-test";
    const next = vi.fn().mockResolvedValue("success");
    const middleware = checkEntitlement("custom-rbac");

    const result = await middleware({ next });

    expect(next).toHaveBeenCalled();
    expect(result).toBe("success");
  });

  it("throws FORBIDDEN when entitlement is missing", async () => {
    delete process.env.LICENSE_KEY;
    const next = vi.fn();
    const middleware = checkEntitlement("custom-rbac");

    await expect(middleware({ next })).rejects.toThrow(TRPCError);
    expect(next).not.toHaveBeenCalled();
  });

  it("includes upgrade message in error", async () => {
    delete process.env.LICENSE_KEY;
    const next = vi.fn();
    const middleware = checkEntitlement("custom-rbac");

    try {
      await middleware({ next });
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
      expect((error as TRPCError).message).toContain(
        "Please upgrade to LangWatch Enterprise"
      );
    }
  });

  it("allows request for base entitlement without license", async () => {
    delete process.env.LICENSE_KEY;
    const next = vi.fn().mockResolvedValue("success");
    const middleware = checkEntitlement("sso-google");

    const result = await middleware({ next });

    expect(next).toHaveBeenCalled();
    expect(result).toBe("success");
  });
});
