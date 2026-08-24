// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A saved edit does not stop at the row it writes.
 *
 * The pull lifecycle reads the source back and re-addresses the process
 * manager from it, so an edit that writes a valid row but leaves the running
 * process pointed at the old configuration is a change the admin can see in
 * the form and never in the data. This suite crosses that boundary on
 * purpose — it is the one place the edit path is checked against something
 * other than its own return value.
 */

import { describe, expect, it, vi } from "vitest";
import { syncIngestionPullSource } from "../../../services/pullers/ingestionPullLifecycle";
import { recommendedPullSchedule } from "../../logic/pullCadence";
import { buildEditSubmission, seedPullSchedule } from "../inventory";

// `resolvePullConfig` toasts the offending field when a pull config will not
// build. That is the behaviour under test's own reporting channel, not a
// dependency of it, and Chakra's toaster has no store outside a rendered app.
vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// The lifecycle looks up the hidden governance project to address the process
// manager. Which project it lands on is not what these tests are about.
vi.mock("../../../services/governanceProject.service", () => ({
  ensureHiddenGovernanceProject: vi.fn().mockResolvedValue({ id: "proj_gov" }),
  PROJECT_KIND: { INTERNAL_GOVERNANCE: "internal_governance" },
}));

/**
 * Reaches across into the poller lifecycle on purpose. The cadence bug was
 * never visible inside either half: the drawer emitted a defensible `null`
 * and the lifecycle correctly read `null` as "disable". Only a test that runs
 * the edit path's output through the thing that consumes it can fail.
 */
describe("given a saved edit that reaches the pull lifecycle", () => {
  function sourceRowFrom(submission: { pullSchedule?: string | null }) {
    return {
      id: "src_1",
      organizationId: "org_1",
      status: "active",
      archivedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      pollerCursor: null,
      pullSchedule: submission.pullSchedule ?? null,
    } as unknown as Parameters<typeof syncIngestionPullSource>[0]["source"];
  }

  async function syncAfterEdit(pullSchedule: string) {
    const submission = buildEditSubmission({
      organizationId: "org_1",
      source: {
        id: "src_1",
        sourceType: "anthropic_admin",
        parserConfig: {
          adapter: "anthropic_admin",
          report: "usage",
          bucketWidth: "1h",
          schedule: "0 * * * *",
        },
      },
      name: "Anthropic org spend",
      description: "",
      parserConfig: {
        credentialsToken: "",
        report: "usage",
        bucketWidth: "1h",
      },
      ottlStatements: [],
      pullSchedule,
      // A pull source never offers the destination picker, so an edit of one
      // always leaves it untouched.
      destination: undefined,
    });
    const commands = { configure: vi.fn(), disable: vi.fn() };

    await syncIngestionPullSource({
      prisma: {} as never,
      source: sourceRowFrom(submission ?? {}),
      commands,
    });

    return { submission, commands };
  }

  describe("when the admin clears the cadence field", () => {
    it("keeps the source pulling on the recommended cadence", async () => {
      const { submission, commands } = await syncAfterEdit("   ");

      // The lifecycle outcome first: this is the assertion that fails when the
      // edit path goes back to saving null, and the one that says what the
      // admin actually loses — a source that has stopped pulling.
      expect(commands.disable).not.toHaveBeenCalled();
      expect(commands.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: "src_1",
          cron: recommendedPullSchedule("anthropic_admin"),
        }),
      );
      expect(submission?.pullSchedule).toBe(
        recommendedPullSchedule("anthropic_admin"),
      );
    });
  });

  describe("when the admin types an explicit cadence", () => {
    it("runs the source on the cadence that was typed", async () => {
      const { commands } = await syncAfterEdit("0 */2 * * *");

      expect(commands.disable).not.toHaveBeenCalled();
      expect(commands.configure).toHaveBeenCalledWith(
        expect.objectContaining({ cron: "0 */2 * * *" }),
      );
    });
  });
});

/**
 * The drifted row, from the drawer opening to the process manager.
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

  /** The row as it comes back for the lifecycle to re-address the process. */
  function rowFrom(submission: { pullSchedule?: string | null }) {
    return {
      id: "src_1",
      organizationId: "org_1",
      status: "active",
      archivedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      pollerCursor: null,
      pullSchedule: submission.pullSchedule ?? null,
    } as unknown as Parameters<typeof syncIngestionPullSource>[0]["source"];
  }

  async function renameAndSync(seededCadence: string) {
    const submission = buildEditSubmission({
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
    });
    const commands = { configure: vi.fn(), disable: vi.fn() };

    await syncIngestionPullSource({
      prisma: {} as never,
      source: rowFrom(submission ?? {}),
      commands,
    });

    return { submission, commands };
  }

  describe("when a rename is seeded from the column", () => {
    it("leaves the source running on the cadence it was already running on", async () => {
      const { submission, commands } = await renameAndSync(
        seedPullSchedule({ pullSchedule: RUNNING, storedParserConfig: STORED }),
      );

      // The outcome that matters: the process manager is re-addressed to the
      // same cron it already had. A rename does not change how often we poll.
      expect(commands.configure).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: "src_1", cron: RUNNING }),
      );
      expect(submission?.pullSchedule).toBe(RUNNING);
    });

    it("converges the parser config's stale copy onto the column", async () => {
      // The save writes both from one value, so the row stops being divergent.
      // Nothing repairs these rows in bulk; editing one is what fixes it.
      const { submission } = await renameAndSync(
        seedPullSchedule({ pullSchedule: RUNNING, storedParserConfig: STORED }),
      );

      expect(
        (submission?.parserConfig as Record<string, unknown>).schedule,
      ).toBe(RUNNING);
    });
  });

  describe("when a rename is seeded from the parser copy instead", () => {
    it("moves the live cadence onto the stale copy", async () => {
      // Pins the damage rather than the fix. This is what shipped before: the
      // seed came from `parserConfig.schedule`, and the rename silently moved
      // the source from six-hourly to hourly.
      const { commands } = await renameAndSync(STORED.schedule);

      expect(commands.configure).toHaveBeenCalledWith(
        expect.objectContaining({ cron: "0 * * * *" }),
      );
      expect(commands.configure).not.toHaveBeenCalledWith(
        expect.objectContaining({ cron: RUNNING }),
      );
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
    it("leaves it disabled, whatever cadence the form submits", async () => {
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
      });

      // The submission carries a perfectly good cron. The status is what stops
      // it, and the submission has no opinion about the status.
      expect(submission?.pullSchedule).toBe("0 */6 * * *");
      expect(submission).not.toHaveProperty("status");

      const commands = { configure: vi.fn(), disable: vi.fn() };
      await syncIngestionPullSource({
        prisma: {} as never,
        source: {
          id: "src_1",
          organizationId: "org_1",
          status: "disabled",
          archivedAt: null,
          updatedAt: new Date("2026-01-01T00:00:00Z"),
          pollerCursor: null,
          pullSchedule: submission?.pullSchedule ?? null,
        } as unknown as Parameters<typeof syncIngestionPullSource>[0]["source"],
        commands,
      });

      expect(commands.disable).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: "src_1" }),
      );
      expect(commands.configure).not.toHaveBeenCalled();
    });
  });
});
