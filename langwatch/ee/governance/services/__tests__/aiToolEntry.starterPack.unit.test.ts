// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import {
  AiToolEntryService,
  STARTER_PACK_TILES,
} from "../aiToolEntry.service";

/**
 * Regression guard for specs/ai-gateway/governance/ingestion-templates-catalog.feature
 * scenario "A platform coding assistant never appears as an ingestion template"
 * (Option B): opencode is a fully unified coding assistant, so it ships as an
 * AiToolsPortal coding_assistant starter tile with `langwatch opencode` as the
 * setup command, not as an ingestion template.
 */
describe("STARTER_PACK_TILES", () => {
  describe("given the opencode coding-assistant tile", () => {
    const opencode = STARTER_PACK_TILES.find((t) => t.slug === "opencode");

    /** @scenario A platform coding assistant never appears as an ingestion template */
    it("is seeded as a coding_assistant tile", () => {
      expect(opencode).toBeDefined();
      expect(opencode?.type).toBe("coding_assistant");
    });

    it("wires the unified `langwatch opencode` setup command", () => {
      expect(opencode?.config.setupCommand).toBe("langwatch opencode");
      expect(opencode?.config.assistantKind).toBe("opencode");
    });
  });

  describe("given every platform coding assistant", () => {
    it("ships each unified CLI as a coding_assistant starter tile", () => {
      const codingTiles = STARTER_PACK_TILES.filter(
        (t) => t.type === "coding_assistant",
      ).map((t) => t.slug);
      for (const slug of ["claude-code", "codex", "gemini", "opencode"]) {
        expect(codingTiles).toContain(slug);
      }
    });
  });
});

/**
 * Contract for specs/ai-governance/personal-portal/portal-grid.feature
 * scenario "brand-new org suggests the default coding assistants to a
 * member": the empty-catalog /me portal renders this projection as
 * functional suggested tiles.
 */
describe("AiToolEntryService.listSuggestedPortalTiles", () => {
  const suggested = AiToolEntryService.listSuggestedPortalTiles();

  /** @scenario brand-new org suggests the default coding assistants to a member */
  it("returns only coding assistants, Claude Code first", () => {
    expect(suggested.every((t) => t.type === "coding_assistant")).toBe(true);
    expect(suggested[0]?.slug).toBe("claude-code");
  });

  it("returns render-ready tiles with icon and setup command", () => {
    for (const tile of suggested) {
      expect(tile.iconAsset).toMatch(/^preset:/);
      expect(tile.config.setupCommand).toMatch(/^langwatch /);
    }
  });
});
