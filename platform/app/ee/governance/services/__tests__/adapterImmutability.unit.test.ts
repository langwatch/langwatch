// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The adapter a source runs under is fixed at create, and this is why.
 *
 * A pull source holds a credential the caller cannot read: the stored envelope
 * is encrypted, the edit form never renders it, and an update that omits it
 * carries the stored value across untouched. That is the right behaviour and
 * it is also what makes the adapter dangerous to edit — the secret survives
 * the edit, and the adapter decides where it gets sent.
 *
 * The destination check reads the adapter off the stored row precisely so a
 * request cannot dodge it by claiming to be something else. But reading the
 * stored adapter only decides which rule to apply; on its own it does not stop
 * the request writing a different adapter for the *next* run to use. A caller
 * with edit rights could satisfy the Databricks host rule with a genuine
 * workspace URL, ship `adapter: "http_polling"` and a URL of their own in the
 * same request, and have the worker hand the stored token to that URL on the
 * following tick. They never read the secret; the server delivers it.
 *
 * So the two rules are one rule. Pinning the adapter is what lets the
 * destination check mean anything: a config can only be judged against the
 * rules of the adapter that will actually run it.
 *
 * Spec: specs/governance/edit-pull-source-config.feature
 */

import { assertAdapterUnchanged } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { describe, expect, it } from "vitest";

describe("given an edit to a source that already holds a credential", () => {
  it("refuses to repoint a Databricks source at a generic HTTP puller", () => {
    expect(() =>
      assertAdapterUnchanged({
        stored: { adapter: "databricks_genie" },
        incoming: {
          adapter: "http_polling",
          // A real workspace URL, present only to satisfy the destination
          // check. The adapter beside it is what would actually run.
          workspaceUrl: "https://real.cloud.databricks.com",
          url: "https://attacker.example/collect",
          authMode: "bearer",
        },
      }),
    ).toThrow(/fixed when the source is created/);
  });

  it("says which adapter the source is on, so the refusal is actionable", () => {
    expect(() =>
      assertAdapterUnchanged({
        stored: { adapter: "databricks_genie" },
        incoming: { adapter: "http_polling" },
      }),
    ).toThrow(/databricks_genie/);
  });

  it("allows an edit that leaves the adapter alone", () => {
    expect(() =>
      assertAdapterUnchanged({
        stored: { adapter: "copilot_studio_dataverse" },
        incoming: {
          adapter: "copilot_studio_dataverse",
          environmentUrl: "https://org.crm.dynamics.com",
        },
      }),
    ).not.toThrow();
  });

  it("treats an absent adapter as unchanged, because the form never sends it", () => {
    // The composer renders no adapter field, so every ordinary edit arrives
    // without one. Refusing those would break the edit drawer outright.
    expect(() =>
      assertAdapterUnchanged({
        stored: { adapter: "copilot_studio_dataverse" },
        incoming: { environmentUrl: "https://org.crm.dynamics.com" },
      }),
    ).not.toThrow();
  });

  it("has nothing to protect on a source that stores no adapter", () => {
    expect(() =>
      assertAdapterUnchanged({
        stored: {},
        incoming: { adapter: "http_polling" },
      }),
    ).not.toThrow();
  });
});
