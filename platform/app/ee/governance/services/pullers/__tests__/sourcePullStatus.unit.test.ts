// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the source page says about a pull that failed.
 * Spec: specs/governance/ingestion-source-health.feature
 *
 * The provider's reply may carry a token, so nearly every failure collapses
 * to a fixed sentence. A refused key is the one failure whose message the
 * run handler wrote itself, and the one an admin can act on, so it is the
 * one that is shown as written.
 */
import { describe, expect, it } from "vitest";

import { sourcePullStatus } from "../sourcePullStatus";

const status = (pullRun: Parameters<typeof sourcePullStatus>[0]["pullRun"]) =>
  sourcePullStatus({
    sourceType: "anthropic_admin",
    cursor: null,
    pullRun,
  });

describe("given a source whose last run ended because the provider refused its key", () => {
  /** @scenario "The source health row says the key was refused" */
  it("says the provider refused the key and what to check", () => {
    const pull = status({
      LastRunAt: 1,
      LastRunOutcome: "failed",
      LastRunError:
        "Anthropic refused this key. Check the admin key and its permissions.",
      LastRunErrorCode: "pull_refused",
    });
    expect(pull?.error).toBe(
      "Anthropic refused this key. Check the admin key and its permissions.",
    );
  });

  it("still collapses any other failure to the generic sentence", () => {
    const pull = status({
      LastRunAt: 1,
      LastRunOutcome: "failed",
      LastRunError: "HTTP 500 (anthropic cost_report): sk-admin leaked here",
      LastRunErrorCode: "pull_failed",
    });
    expect(pull?.error).toBe("The last pull failed.");
    expect(JSON.stringify(pull)).not.toContain("sk-admin");
  });
});

describe("given a source whose last run was refused without a sentence of ours to show", () => {
  /** @scenario "A refusal with no customer sentence shows the generic failure text" */
  it("shows the generic failure text and quotes nothing from the provider", () => {
    // The run handler writes the generic failed code for such a refusal, so
    // the raw diagnostic arrives under `pull_failed`, never `pull_refused`.
    const pull = status({
      LastRunAt: 1,
      LastRunOutcome: "failed",
      LastRunError: "HTTP 403 (anthropic cost_report): sk-admin refused",
      LastRunErrorCode: "pull_failed",
    });
    expect(pull?.error).toBe("The last pull failed.");
    expect(JSON.stringify(pull)).not.toContain("sk-admin");
    expect(JSON.stringify(pull)).not.toContain("403");
  });
});
