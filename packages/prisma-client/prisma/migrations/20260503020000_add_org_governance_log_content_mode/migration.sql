-- Phase 9 — receiver-side gen_ai content stripping ("no-spy mode").
-- Per-org admin toggle that drops gen_ai content payloads from
-- gateway-origin spans BEFORE the ClickHouse write, enforcing the
-- "we do not retain employee conversational content" guarantee in the
-- pipeline rather than via trust + later cleanup.
--
-- Values: "full" (default, current behavior) | "strip_io" | "strip_all".
-- Spec: specs/ai-governance/no-spy-mode/no-spy-mode.feature.
ALTER TABLE "Organization"
  ADD COLUMN "governanceLogContentMode" TEXT NOT NULL DEFAULT 'full';
