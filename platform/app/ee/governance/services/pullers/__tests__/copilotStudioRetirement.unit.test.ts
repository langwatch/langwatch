/**
 * The retirement half of #7137, asserted rather than assumed.
 *
 * These read as trivia until you notice what they are protecting against:
 * the whole defect was a source whose description and code disagreed for
 * months without anything failing. A grep-shaped test is a cheap way to make
 * that class of drift loud.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { registerBuiltInPullers } from "../index";
import { pullerAdapterRegistry } from "../pullerAdapter";

const APP_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const REPO_ROOT = join(APP_ROOT, "..", "..");

const read = (relativeToRepo: string): string =>
  readFileSync(join(REPO_ROOT, relativeToRepo), "utf8");

describe("copilot_studio retirement", () => {
  /** @scenario "The registry no longer resolves the copilot_studio adapter id" */
  it("resolves microsoft_365_audit and nothing for the retired id", () => {
    registerBuiltInPullers();

    expect(pullerAdapterRegistry.get("copilot_studio")).toBeUndefined();

    const replacement = pullerAdapterRegistry.get("microsoft_365_audit");
    expect(replacement).toBeDefined();
    expect(replacement?.id).toBe("microsoft_365_audit");
    expect(pullerAdapterRegistry.ids()).not.toContain("copilot_studio");
  });

  /** @scenario "The two known-false copy strings are gone" */
  it("no longer claims a Purview API it never called, nor hashing it never did", () => {
    const composer = read(
      "platform/app/ee/governance/dashboard/pages/ingestion-sources.tsx",
    );

    // Claimed the source polls the Purview Audit API. No code ever called it.
    expect(composer).not.toContain("Polls Microsoft Purview Audit API");
    // Claimed the client secret is hashed server-side. Nothing hashed it, and
    // nothing could: the puller has to present the real value to Microsoft.
    expect(composer).not.toContain(
      "We hash this server-side; only the hash is persisted.",
    );

    // What replaced them names the API that is actually called.
    expect(composer).toContain("Office 365 Management Activity API");
    expect(composer).toContain("ActivityFeed.Read");
  });

  /** @scenario "Documentation stops describing a poller that has not shipped" */
  it("documents the shipped puller and keeps the published URL resolving", () => {
    const page = read(
      "docs/ai-governance/ingestion-sources/microsoft-365-audit.mdx",
    );

    expect(page).toContain("Office 365 Management Activity API");
    expect(page).toContain("ActivityFeed.Read");
    // The stale claim that no poller exists.
    expect(page).not.toContain("events do not flow yet");
    expect(page).not.toContain("Poller:** none");
    // The feed does not backfill, and an operator has to be told so.
    expect(page).toContain("does not backfill");
    // An operator with the retired source needs to know to re-create it.
    expect(page).toContain("re-create");

    // Parsed, not string-matched: a formatter that rewraps docs.json must
    // not be able to break this test, and a redirect whose destination is
    // wrong reads exactly like a correct one in the raw text.
    const docsJson = JSON.parse(read("docs/docs.json")) as {
      redirects?: Array<{ source: string; destination: string }>;
    };
    const redirects = docsJson.redirects ?? [];

    for (const source of [
      "/ai-gateway/governance/ingestion-sources/copilot-studio",
      "/ai-governance/ingestion-sources/copilot-studio",
    ]) {
      const redirect = redirects.find((entry) => entry.source === source);

      // Both previously published URLs still resolve rather than 404.
      expect(redirect, `no redirect declared for ${source}`).toBeDefined();
      expect(redirect?.destination).toBe(
        "/ai-governance/ingestion-sources/microsoft-365-audit",
      );

      // And the page it lands on is really there — a redirect to a missing
      // page is a 404 with extra steps.
      expect(() =>
        read(`docs${redirect?.destination ?? ""}.mdx`),
      ).not.toThrow();
    }
    // And the old page is genuinely gone, not merely unlinked.
    expect(() =>
      read("docs/ai-governance/ingestion-sources/copilot-studio.mdx"),
    ).toThrow();
  });
});

describe("ingestion-source picker", () => {
  /** @scenario "copilot_studio can no longer be selected in the picker" */
  it("offers microsoft_365_audit and not the retired source type", () => {
    const composer = read(
      "platform/app/ee/governance/dashboard/pages/ingestion-sources.tsx",
    );

    // The composer builds its picker from SOURCE_TYPE_OPTIONS, so an entry
    // that is not there cannot be selected.
    expect(composer).not.toContain('value: "copilot_studio"');
    expect(composer).toContain('value: "microsoft_365_audit"');

    // And it is gone from the union type, so a stale value would not typecheck.
    expect(composer).not.toContain('| "copilot_studio"');
    expect(composer).toContain('| "microsoft_365_audit"');
  });
});
