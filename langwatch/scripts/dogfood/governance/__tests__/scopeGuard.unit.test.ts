import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  assertDemoOrgAllowed,
  DemoOrgScope,
  DemoScopeMisconfigured,
  DemoScopeViolation,
  parseDemoOrgIdsEnv,
} from "../_lib/scopeGuard";

describe("parseDemoOrgIdsEnv", () => {
  describe("when the env var is missing or empty", () => {
    it("throws DemoScopeMisconfigured for undefined", () => {
      expect(() => parseDemoOrgIdsEnv(undefined)).toThrow(
        DemoScopeMisconfigured,
      );
    });

    it("throws DemoScopeMisconfigured for empty string", () => {
      expect(() => parseDemoOrgIdsEnv("")).toThrow(DemoScopeMisconfigured);
    });

    it("throws DemoScopeMisconfigured for whitespace-only", () => {
      expect(() => parseDemoOrgIdsEnv("   ")).toThrow(DemoScopeMisconfigured);
    });

    it("throws DemoScopeMisconfigured when only commas + whitespace", () => {
      expect(() => parseDemoOrgIdsEnv(", , ,")).toThrow(
        DemoScopeMisconfigured,
      );
    });
  });

  describe("when the env var contains valid ids", () => {
    it("parses a single id", () => {
      expect(parseDemoOrgIdsEnv("org_acme123")).toEqual(["org_acme123"]);
    });

    it("parses comma-separated ids and trims whitespace", () => {
      expect(parseDemoOrgIdsEnv("org_acme123, org_beta456 ,org_gamma789")).toEqual([
        "org_acme123",
        "org_beta456",
        "org_gamma789",
      ]);
    });

    it("dedupes repeated ids", () => {
      expect(parseDemoOrgIdsEnv("org_acme123,org_acme123,org_beta456")).toEqual([
        "org_acme123",
        "org_beta456",
      ]);
    });
  });

  describe("when the env var contains a malformed id", () => {
    it("rejects ids shorter than 8 chars", () => {
      expect(() => parseDemoOrgIdsEnv("short")).toThrow(DemoScopeMisconfigured);
    });

    it("rejects ids with disallowed characters (spaces inside)", () => {
      expect(() => parseDemoOrgIdsEnv("org acme123")).toThrow(
        DemoScopeMisconfigured,
      );
    });

    it("rejects ids with sql-injection-shaped characters", () => {
      expect(() => parseDemoOrgIdsEnv("org_acme';--")).toThrow(
        DemoScopeMisconfigured,
      );
    });

    it("rejects mixed-valid-and-invalid lists at the first invalid id", () => {
      expect(() =>
        parseDemoOrgIdsEnv("org_acme123,bad id,org_beta456"),
      ).toThrow(DemoScopeMisconfigured);
    });
  });
});

describe("assertDemoOrgAllowed", () => {
  it("returns void for an in-allowlist id", () => {
    expect(() =>
      assertDemoOrgAllowed("org_acme123", ["org_acme123", "org_beta456"]),
    ).not.toThrow();
  });

  it("throws DemoScopeViolation for an off-allowlist id", () => {
    expect(() =>
      assertDemoOrgAllowed("org_evil999", ["org_acme123", "org_beta456"]),
    ).toThrow(DemoScopeViolation);
  });

  it("throws DemoScopeViolation when the allowlist is empty", () => {
    expect(() => assertDemoOrgAllowed("org_acme123", [])).toThrow(
      DemoScopeViolation,
    );
  });

  it("is case-sensitive", () => {
    expect(() =>
      assertDemoOrgAllowed("ORG_ACME123", ["org_acme123"]),
    ).toThrow(DemoScopeViolation);
  });
});

describe("DemoOrgScope", () => {
  describe("construction", () => {
    it("refuses an empty allowlist", () => {
      expect(() => new DemoOrgScope([])).toThrow(DemoScopeMisconfigured);
    });

    it("constructs from a non-empty allowlist", () => {
      const scope = new DemoOrgScope(["org_acme123"]);
      expect(scope.getAllowlist()).toEqual(["org_acme123"]);
    });

    it("returns a defensive copy of the allowlist", () => {
      const input = ["org_acme123"];
      const scope = new DemoOrgScope(input);
      input.push("org_evil999");
      expect(scope.getAllowlist()).toEqual(["org_acme123"]);
    });
  });

  describe("fromEnv", () => {
    it("constructs from the env var", () => {
      const scope = DemoOrgScope.fromEnv({
        DEMO_ORG_IDS: "org_acme123,org_beta456",
      });
      expect(scope.getAllowlist()).toEqual(["org_acme123", "org_beta456"]);
    });

    it("throws when the env var is missing", () => {
      expect(() => DemoOrgScope.fromEnv({})).toThrow(DemoScopeMisconfigured);
    });
  });

  describe("loadOrg", () => {
    it("asserts allowlist BEFORE issuing the prisma read", async () => {
      const findUnique = vi.fn();
      const prisma = {
        organization: { findUnique },
      } as unknown as PrismaClient;
      const scope = new DemoOrgScope(["org_acme123"]);

      await expect(scope.loadOrg(prisma, "org_evil999")).rejects.toThrow(
        DemoScopeViolation,
      );
      expect(findUnique).not.toHaveBeenCalled();
    });

    it("returns the org row when allowlisted + present", async () => {
      const orgRow = { id: "org_acme123", name: "ACME" };
      const findUnique = vi.fn().mockResolvedValue(orgRow);
      const prisma = {
        organization: { findUnique },
      } as unknown as PrismaClient;
      const scope = new DemoOrgScope(["org_acme123"]);

      const result = await scope.loadOrg(prisma, "org_acme123");
      expect(result).toBe(orgRow);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "org_acme123" },
      });
    });

    it("throws DemoScopeViolation when allowlisted but not in DB", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = {
        organization: { findUnique },
      } as unknown as PrismaClient;
      const scope = new DemoOrgScope(["org_acme123"]);

      await expect(scope.loadOrg(prisma, "org_acme123")).rejects.toThrow(
        DemoScopeViolation,
      );
    });
  });

  describe("loadProject", () => {
    it("loads the project chain and asserts the parent org is allowlisted", async () => {
      const projectRow = {
        id: "proj_xyz",
        team: { organization: { id: "org_acme123" } },
      };
      const findUnique = vi.fn().mockResolvedValue(projectRow);
      const prisma = {
        project: { findUnique },
      } as unknown as PrismaClient;
      const scope = new DemoOrgScope(["org_acme123"]);

      const result = await scope.loadProject(prisma, "proj_xyz");
      expect(result).toBe(projectRow);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "proj_xyz" },
        include: { team: { include: { organization: true } } },
      });
    });

    it("throws DemoScopeViolation when project's parent org is off-list", async () => {
      const projectRow = {
        id: "proj_xyz",
        team: { organization: { id: "org_evil999" } },
      };
      const findUnique = vi.fn().mockResolvedValue(projectRow);
      const prisma = {
        project: { findUnique },
      } as unknown as PrismaClient;
      const scope = new DemoOrgScope(["org_acme123"]);

      await expect(scope.loadProject(prisma, "proj_xyz")).rejects.toThrow(
        DemoScopeViolation,
      );
    });

    it("throws DemoScopeViolation when project does not exist", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = {
        project: { findUnique },
      } as unknown as PrismaClient;
      const scope = new DemoOrgScope(["org_acme123"]);

      await expect(scope.loadProject(prisma, "proj_missing")).rejects.toThrow(
        DemoScopeViolation,
      );
    });
  });
});
