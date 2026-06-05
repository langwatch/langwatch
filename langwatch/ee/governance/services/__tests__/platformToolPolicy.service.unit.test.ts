// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  PLATFORM_TOOL_POLICY_DEFAULTS,
  PlatformToolPolicyService,
  UnknownPlatformToolError,
} from "../platformToolPolicy.service";

describe("PlatformToolPolicyService", () => {
  describe("getForOrg", () => {
    describe("when the org has no stored rows", () => {
      it("returns the hardcoded defaults for every tool", async () => {
        const prisma = {
          platformToolPolicy: { findMany: vi.fn().mockResolvedValue([]) },
        } as unknown as PrismaClient;

        const map = await PlatformToolPolicyService.create(prisma).getForOrg({
          organizationId: "org-1",
        });

        expect(map).toEqual(PLATFORM_TOOL_POLICY_DEFAULTS);
        // cursor's OTLP-direct default stays off.
        expect(map.cursor).toEqual({ allowVk: true, allowOtelDirect: false });
      });
    });

    describe("when a stored row overrides a default", () => {
      it("merges the stored row over the default and keeps other tools default", async () => {
        const prisma = {
          platformToolPolicy: {
            findMany: vi.fn().mockResolvedValue([
              { toolSlug: "claude", allowVk: true, allowOtelDirect: false },
            ]),
          },
        } as unknown as PrismaClient;

        const map = await PlatformToolPolicyService.create(prisma).getForOrg({
          organizationId: "org-1",
        });

        expect(map.claude).toEqual({ allowVk: true, allowOtelDirect: false });
        expect(map.codex).toEqual({ allowVk: true, allowOtelDirect: true });
      });
    });
  });

  describe("update", () => {
    describe("when the tool slug is not one of the five known tools", () => {
      it("throws UnknownPlatformToolError without writing", async () => {
        const prisma = {} as unknown as PrismaClient;

        await expect(
          PlatformToolPolicyService.create(prisma).update({
            organizationId: "org-1",
            toolSlug: "not-a-tool",
            allowVk: false,
            callerUserId: "user-1",
          }),
        ).rejects.toBeInstanceOf(UnknownPlatformToolError);
      });
    });

    describe("when toggling one path on a tool with no stored row", () => {
      it("merges over the default so the untouched path keeps its default value", async () => {
        const upsert = vi.fn().mockResolvedValue({
          id: "row-1",
          allowVk: true,
          allowOtelDirect: false,
        });
        const findUnique = vi.fn().mockResolvedValue(null);
        const emit = vi.fn().mockResolvedValue({ id: "audit-1" });
        const tx = {
          platformToolPolicy: { findUnique, upsert },
          auditLog: { create: emit },
        };
        const prisma = {
          $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
        } as unknown as PrismaClient;

        const result = await PlatformToolPolicyService.create(prisma).update({
          organizationId: "org-1",
          toolSlug: "claude",
          allowOtelDirect: false,
          callerUserId: "user-1",
        });

        expect(result).toEqual({ allowVk: true, allowOtelDirect: false });
        // create branch carries the merged after-state (allowVk default true).
        expect(upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({
              organizationId: "org-1",
              toolSlug: "claude",
              allowVk: true,
              allowOtelDirect: false,
            }),
          }),
        );
        // audit row carries before (default) + after.
        expect(emit).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              action: "gateway.platform_tool_policy.updated",
              before: { allowVk: true, allowOtelDirect: true },
              after: { allowVk: true, allowOtelDirect: false },
            }),
          }),
        );
      });
    });
  });
});
