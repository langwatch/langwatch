// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import {
  PLATFORM_INGESTION_TEMPLATES,
  RETIRED_PLATFORM_TEMPLATE_SLUGS,
} from "../platformIngestionTemplates.seeds";

/**
 * Regression guard for specs/ai-gateway/governance/ingestion-templates-catalog.feature
 * scenario "The platform-template seed produces no coding-assistant rows".
 *
 * The platform's coding assistants are owned by `langwatch <tool>` + the
 * receiver log-to-span conversion, so they are NOT seeded as ingestion
 * templates. There is no flag and no filter: they are simply absent from
 * the seed input. Any rows a previous seed created are archived via the
 * retired-slugs list so dev DBs converge to the v1 catalog.
 */
const CODING_ASSISTANT_SLUGS = [
  "claude_code",
  "codex",
  "cursor",
  "gemini",
  "opencode",
] as const;

describe("PLATFORM_INGESTION_TEMPLATES", () => {
  describe("given the v1 platform seed input", () => {
    it("seeds claude_cowork as the only platform coding-tool template", () => {
      const slugs = PLATFORM_INGESTION_TEMPLATES.map((t) => t.slug);
      expect(slugs).toEqual(["claude_cowork"]);
    });

    /** @scenario The platform-template seed produces no coding-assistant rows */
    it("excludes every platform coding assistant from the seed input", () => {
      const slugs = new Set(PLATFORM_INGESTION_TEMPLATES.map((t) => t.slug));
      for (const codingSlug of CODING_ASSISTANT_SLUGS) {
        expect(slugs.has(codingSlug)).toBe(false);
      }
    });
  });

  describe("given a dev DB that may hold rows from an earlier seed run", () => {
    it("retires every coding-assistant slug so stale rows get archived", () => {
      for (const codingSlug of CODING_ASSISTANT_SLUGS) {
        expect(RETIRED_PLATFORM_TEMPLATE_SLUGS).toContain(codingSlug);
      }
    });
  });
});
