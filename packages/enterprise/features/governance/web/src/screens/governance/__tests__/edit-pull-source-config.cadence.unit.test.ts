// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The cadence an edit hands the pull lifecycle, seen from this side of the
 * boundary.
 *
 * WHAT THIS FILE USED TO BE, AND WHY IT IS SMALLER. Its ancestor
 * (`platform/app/src/pages/governance/__tests__/editPullSourceConfig.lifecycle.unit.test.ts`)
 * ran each submission through `IngestionPullLifecycleService.sync` from
 * `@langwatch/enterprise-governance-server` and asserted on the process
 * manager: `configure` with a cron, or `disable`. That crossing is the whole
 * value of the suite — the cadence bug was never visible inside either half,
 * because the drawer emitted a defensible `null` and the lifecycle correctly
 * read `null` as "disable" — and it is exactly the crossing a feature-web
 * package may not make: ADR-004 seals a web package off from its server
 * sibling, which is not a declared dependency here and must not become one.
 *
 * So what stays is the half that is genuinely this package's: what the edit
 * path SUBMITS. Every assertion below is on the submission, and each one is
 * the input to a lifecycle assertion that now has no home. The pairing is
 * recorded here rather than dropped silently, because a submission carrying
 * the right cron is only interesting while something still checks that the
 * lifecycle runs it.
 */

import { describe, expect, it } from "vitest";
import { recordingGovernanceToaster } from "../../../testing";
import { buildEditSubmission, seedPullSchedule } from "../governance-inventory.screen";

/**
 * The drifted row, from the drawer opening to the payload it saves.
 *
 * `pullSchedule` and `parserConfig.schedule` are two copies of one value, and
 * the column is the only one the lifecycle reads. The drawer used to seed from
 * the copy, so an admin who opened a drifted source and changed nothing but
 * the name handed the save path the stale value — and the save path writes
 * that field straight back to the column. The damage was never visible in
 * either half on its own: the drawer emitted a schedule it had honestly been
 * given, and the lifecycle honestly ran it.
 */
describe("given a row whose column and parser copy disagree", () => {
  const STORED = {
    adapter: "anthropic_admin",
    report: "usage",
    bucketWidth: "1h",
    // The copy, left behind by whatever last wrote the column without it.
    schedule: "0 * * * *",
  };
  /** What the source is really running on. */
  const RUNNING = "0 */6 * * *";

  function rename(seededCadence: string) {
    return buildEditSubmission({
      organizationId: "org_1",
      source: {
        id: "src_1",
        sourceType: "anthropic_admin",
        parserConfig: STORED,
      },
      name: "Anthropic org spend (renamed)",
      description: "",
      parserConfig: {
        credentialsToken: "",
        report: "usage",
        bucketWidth: "1h",
      },
      ottlStatements: [],
      pullSchedule: seededCadence,
      // A pull source never offers the destination picker, so an edit of one
      // leaves the field untouched.
      destination: undefined,
      toaster: recordingGovernanceToaster(),
    });
  }

  describe("when a rename is seeded from the column", () => {
    it("saves the cadence the source was already running on", () => {
      const submission = rename(
        seedPullSchedule({ pullSchedule: RUNNING, storedParserConfig: STORED }),
      );

      // A rename does not change how often we poll. This is the value the
      // lifecycle re-addresses the process manager with.
      expect(submission?.pullSchedule).toBe(RUNNING);
    });

    it("converges the parser config's stale copy onto the column", () => {
      // The save writes both from one value, so the row stops being divergent.
      // Nothing repairs these rows in bulk; editing one is what fixes it.
      const submission = rename(
        seedPullSchedule({ pullSchedule: RUNNING, storedParserConfig: STORED }),
      );

      expect((submission?.parserConfig as Record<string, unknown>).schedule).toBe(RUNNING);
    });
  });

  describe("when a rename is seeded from the parser copy, as it once was", () => {
    it("silently moves the live cadence onto the stale copy", () => {
      // Pins the damage rather than the fix. This is what shipped before: the
      // seed came from `parserConfig.schedule`, and the rename silently moved
      // the source from six-hourly to hourly.
      const submission = rename(STORED.schedule);

      expect(submission?.pullSchedule).toBe("0 * * * *");
      expect(submission?.pullSchedule).not.toBe(RUNNING);
    });
  });
});

/**
 * `status: "disabled"` is the sanctioned off switch: it is a first-class value
 * of the router's status enum, and the edit path never writes status, so a
 * rename cannot reach it. This is the guarantee worth pinning — the review
 * asked whether an edit can revive a stopped source, and for the way sources
 * are actually stopped, the answer has to stay no.
 */
describe("given a source an admin has deliberately disabled", () => {
  const STORED = {
    adapter: "anthropic_admin",
    report: "usage",
    bucketWidth: "1h",
    schedule: "0 */6 * * *",
  };

  describe("when an unrelated edit renames it", () => {
    it("submits a working cadence and no opinion at all about the status", () => {
      const submission = buildEditSubmission({
        organizationId: "org_1",
        source: {
          id: "src_1",
          sourceType: "anthropic_admin",
          parserConfig: STORED,
        },
        name: "renamed while stopped",
        description: "",
        parserConfig: {
          credentialsToken: "",
          report: "usage",
          bucketWidth: "1h",
        },
        ottlStatements: [],
        pullSchedule: seedPullSchedule({
          pullSchedule: "0 */6 * * *",
          storedParserConfig: STORED,
        }),
        destination: undefined,
        toaster: recordingGovernanceToaster(),
      });

      // The submission carries a perfectly good cron. The status is what stops
      // it, and the submission has no opinion about the status — which is why
      // the lifecycle still disables the source after this save lands.
      expect(submission?.pullSchedule).toBe("0 */6 * * *");
      expect(submission).not.toHaveProperty("status");
    });
  });
});
