// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import {
  PLATFORM_INGESTION_TEMPLATES,
  RETIRED_PLATFORM_TEMPLATE_SLUGS,
} from "../platformIngestionTemplates.seeds";

/**
 * Regression guard for
 * specs/ai-gateway/governance/ingestion-templates-catalog.feature
 * scenario "The platform-template seed produces no coding-assistant rows"
 * and specs/ai-governance/personal-portal/default-catalog.feature
 * scenario "The platform default template set ships no claude-cowork".
 *
 * The platform ships NO default ingestion templates. The coding
 * assistants are owned by `langwatch <tool>` + the receiver log-to-span
 * conversion, and claude_cowork is retired from the default set. Any
 * rows a previous seed created are archived via the retired-slugs list
 * so dev DBs and production converge to the locked (empty) catalog.
 */
const CODING_ASSISTANT_SLUGS = [
  "claude_code",
  "codex",
  "cursor",
  "gemini",
  "opencode",
] as const;

describe("PLATFORM_INGESTION_TEMPLATES", () => {
  describe("when the platform seed input is inspected", () => {
    /** @scenario The platform-template seed produces no coding-assistant rows */
    it("ships no default template rows at all", () => {
      expect(PLATFORM_INGESTION_TEMPLATES).toEqual([]);
    });

    /** @scenario The platform-template seed produces no coding-assistant rows */
    it("excludes every platform coding assistant from the seed input", () => {
      const slugs = new Set(PLATFORM_INGESTION_TEMPLATES.map((t) => t.slug));
      for (const codingSlug of CODING_ASSISTANT_SLUGS) {
        expect(slugs.has(codingSlug)).toBe(false);
      }
    });
  });

  describe("when a dev DB still holds rows from an earlier seed run", () => {
    it("retires every coding-assistant slug so stale rows get archived", () => {
      for (const codingSlug of CODING_ASSISTANT_SLUGS) {
        expect(RETIRED_PLATFORM_TEMPLATE_SLUGS).toContain(codingSlug);
      }
    });

    /** @scenario The platform default template set ships no claude-cowork */
    it("retires claude_cowork so existing platform rows get archived", () => {
      expect(RETIRED_PLATFORM_TEMPLATE_SLUGS).toContain("claude_cowork");
    });
  });
});
