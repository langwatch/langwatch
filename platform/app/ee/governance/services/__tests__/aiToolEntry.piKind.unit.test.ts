// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

import {
  AiToolConfigSchema,
  AiToolEntryService,
  ASSISTANT_KIND_TO_TOOL_SLUG,
  SUPPORTED_ASSISTANT_KINDS,
} from "../aiToolEntry.service";
import { PLATFORM_TOOL_SLUGS } from "../platformToolPolicy.service";

/**
 * A prisma double serving one org-wide `coding_assistant` tile per
 * assistantKind, each written by an admin who left the path toggles alone
 * (`allowVk` absent, which is what the tile drawer stores until someone
 * touches the switch). Enough for `resolveVisibleTilesForUser`: it reads the
 * member's department, then every enabled row in the org.
 */
function prismaServingTiles(kinds: string[]): PrismaClient {
  return {
    organizationUser: {
      findUnique: async () => ({ departmentId: null }),
    },
    aiToolEntry: {
      findMany: async () =>
        kinds.map((kind, index) => ({
          slug: kind,
          displayName: kind,
          order: index,
          scope: "organization",
          departments: [],
          type: "coding_assistant",
          config: { assistantKind: kind, setupCommand: `langwatch ${kind}` },
        })),
    },
  } as unknown as PrismaClient;
}

/**
 * pi as a governable coding-assistant tile (ADR-132).
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
describe("the pi coding-assistant kind", () => {
  describe("when a pi tile's config is validated on save", () => {
    // `AiToolConfigSchema.parse` is the gate `create` and `update` both run
    // first, so a kind missing from `SUPPORTED_ASSISTANT_KINDS` fails the
    // write with `invalid_enum_value` however the tile was filled in.
    /** @scenario "A pi policy chosen in the tile is accepted when saved" */
    it("is stored rather than rejected", () => {
      const parsed = AiToolConfigSchema.parse({
        type: "coding_assistant",
        config: {
          assistantKind: "pi",
          setupCommand: "langwatch pi",
          allowVk: false,
          allowOtelDirect: true,
        },
      });

      expect(parsed.config).toMatchObject({
        assistantKind: "pi",
        allowVk: false,
        allowOtelDirect: true,
      });
    });

    it("is one of the kinds the write enum accepts", () => {
      expect(SUPPORTED_ASSISTANT_KINDS as readonly string[]).toContain("pi");
    });
  });

  describe("when the kind is mapped to a CLI tool slug", () => {
    // An unmapped kind is skipped by `resolveToolPolicyOverrides` and
    // `resolveCliCatalogForUser` — no error, no entry, and the launcher falls
    // back to the permissive default. This assertion is the only thing
    // standing between a pi tile's policy and that silent default.
    it("maps pi to the `pi` slug", () => {
      expect(ASSISTANT_KIND_TO_TOOL_SLUG.pi).toBe("pi");
    });

    it("maps it to a slug the policy table actually knows", () => {
      expect(PLATFORM_TOOL_SLUGS as readonly string[]).toContain(
        ASSISTANT_KIND_TO_TOOL_SLUG.pi,
      );
    });
  });

  /**
   * Unbound on purpose: no scenario in
   * specs/coding-agent/pi-session-capture.feature covers this. The nearest,
   * "A pi policy set in the tile is the one the launcher applies", is about a
   * policy the tile DOES carry; this is the opposite case — a toggle the tile
   * must not be able to turn back on.
   *
   * Shipping pi as `allowVk: false` in PLATFORM_TOOL_POLICY_DEFAULTS is not
   * enough on its own: the defaults only apply to a slug with no tile, and
   * `resolveToolPolicyOverrides` reads an absent `config.allowVk` as `true`.
   * So the moment an organisation publishes a pi tile — which the tool tile
   * invites them to do — the gateway path came back for every member of that
   * org. It cannot work: pi hardcodes each catalog model's base URL and
   * ignores OPENAI_BASE_URL / ANTHROPIC_BASE_URL, and gateway mode also
   * suppresses the session-file path, so the member captures nothing at all.
   * ADR-132 §7.
   */
  describe("when an organisation publishes a pi tile that leaves the path toggles unset", () => {
    it("keeps pi off the gateway path while a control tool on the same tile shape keeps it", async () => {
      const service = AiToolEntryService.create(
        prismaServingTiles(["pi", "claude_code"]),
      );

      const overrides = await service.resolveToolPolicyOverrides({
        organizationId: "org-1",
        userId: "user-1",
      });

      // The control rules out a pass caused by the tiles not being read at
      // all: claude_code, written exactly the same way, does get the gateway.
      expect(overrides.claude).toEqual({
        allowVk: true,
        allowOtelDirect: true,
      });
      expect(overrides.pi).toEqual({ allowVk: false, allowOtelDirect: true });
    });

    it("keeps pi off the gateway path even when the tile explicitly asks for it", async () => {
      const service = AiToolEntryService.create({
        organizationUser: { findUnique: async () => ({ departmentId: null }) },
        aiToolEntry: {
          findMany: async () => [
            {
              slug: "pi",
              displayName: "pi",
              order: 0,
              scope: "organization",
              departments: [],
              type: "coding_assistant",
              config: {
                assistantKind: "pi",
                setupCommand: "langwatch pi",
                allowVk: true,
              },
            },
          ],
        },
      } as unknown as PrismaClient);

      const overrides = await service.resolveToolPolicyOverrides({
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(overrides.pi).toEqual({ allowVk: false, allowOtelDirect: true });
    });

    /**
     * The tile force above and the shipped default are two independent
     * settings, and this is the one the launcher actually reads for most
     * people: `resolveToolPolicyMap` falls back to
     * PLATFORM_TOOL_POLICY_DEFAULTS for any slug with no tile, the login
     * ceremony caches that map as `cfg.tool_policies`, and the cached entry
     * WINS over the launcher's own hardcoded table. An org with no pi tile —
     * every org today — is governed by this row alone.
     */
    it("ships pi's default with the gateway path already off, for an org with no pi tile", async () => {
      const service = AiToolEntryService.create(
        prismaServingTiles(["claude_code"]),
      );

      const map = await service.resolveToolPolicyMap({
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(map.claude).toEqual({ allowVk: true, allowOtelDirect: true });
      expect(map.pi).toEqual({ allowVk: false, allowOtelDirect: true });
    });
  });
});
