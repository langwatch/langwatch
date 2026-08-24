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
import { buildEditSubmission } from "../inventory";

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
describe("a saved edit reaching the pull lifecycle", () => {
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
    });
    const commands = { configure: vi.fn(), disable: vi.fn() };

    await syncIngestionPullSource({
      prisma: {} as never,
      source: sourceRowFrom(submission ?? {}),
      commands,
    });

    return { submission, commands };
  }

  it("keeps pulling after an admin clears the cadence field", async () => {
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

  it("still runs on an explicitly typed cadence", async () => {
    const { commands } = await syncAfterEdit("0 */2 * * *");

    expect(commands.disable).not.toHaveBeenCalled();
    expect(commands.configure).toHaveBeenCalledWith(
      expect.objectContaining({ cron: "0 */2 * * *" }),
    );
  });
});
