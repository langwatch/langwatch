// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Who a member's send reaches, and what it shows them, is read when it is sent: a member who
 * left or was disabled after the plan is skipped, their current role decides the pick, and the
 * email shows only the projects they may view.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN,
  emailOf,
  installDigest,
  type InstalledDigest,
  MEMBER,
  ORGANIZATION,
  OTHER_MEMBER,
  PROJECT,
  SENT_WEEK,
  WAKE_AT,
} from "./digest.fixture.ts";

/** The week before the sent one, which the scenario baseline reads. */
const BASELINE_WEEK = "2026-W45";

let digest: InstalledDigest;

beforeEach(async () => {
  digest = installDigest();
  await digest.repositories.audience.setArmed({ armed: true });
});

afterEach(async () => {
  await digest.close();
});

/** One member's send of the sent week. */
const sendFor = ({ userId }: { userId: string }) =>
  digest.carryOut({ userId, organizationId: ORGANIZATION, isoWeek: SENT_WEEK });

/** The organization at 90% of its plan, so an admin's pick is plan-pressure. */
function nearTheLimit() {
  digest.world.usage = { currentMonthMessagesCount: 900, maxMonthlyUsageLimit: 1_000 };
}

/** One scenario run on the project's week. */
function scenarioRun({ isoWeek, outcome }: { isoWeek: string; outcome: "passed" | "failed" }) {
  return digest.recordProject({
    tenantId: PROJECT,
    occurredAt: WAKE_AT,
    projectId: PROJECT,
    organizationId: ORGANIZATION,
    isoWeek,
    sourceKey: `scenario-${isoWeek}`,
    fact: { kind: "scenario", scenarioId: "scenario-1", outcome },
  });
}

describe("a member's send", () => {
  describe("when the member left the organization after the plan", () => {
    /** @scenario "A member who left or was disabled after planning is skipped" */
    it("mails them nothing", async () => {
      nearTheLimit();
      digest.world.members = digest.world.members.filter((member) => member.userId !== ADMIN);

      await sendFor({ userId: ADMIN });

      expect(digest.mail).toEqual([]);
    });
  });

  describe("when the member was disabled after the plan", () => {
    /** @scenario "A member who left or was disabled after planning is skipped" */
    it("mails them nothing", async () => {
      nearTheLimit();
      const disabledAt = Temporal.Instant.from("2026-11-16T08:30:00Z");
      digest.world.members = digest.world.members.map((member) =>
        member.userId === ADMIN ? { ...member, disabledAt } : member,
      );

      await sendFor({ userId: ADMIN });

      expect(digest.mail).toEqual([]);
    });
  });

  describe("when an admin became a plain member after the plan", () => {
    /** @scenario "A member's role is read when their email is sent" */
    it("picks for the role they hold now, not the plan's", async () => {
      nearTheLimit();
      digest.world.members = digest.world.members.map((member) =>
        member.userId === ADMIN ? { ...member, role: "MEMBER" } : member,
      );

      await sendFor({ userId: ADMIN });

      expect(digest.mail.flatMap((mail) => mail.props.rows.map((row) => row.kind))).not.toContain(
        "plan",
      );
    });
  });

  describe("when a member may not view the project whose scenarios got worse", () => {
    /** @scenario "A member's email shows only the projects they may view" */
    it("leaves the project out of their email and still shows it to those who may", async () => {
      await scenarioRun({ isoWeek: BASELINE_WEEK, outcome: "passed" });
      await scenarioRun({ isoWeek: SENT_WEEK, outcome: "failed" });
      await vi.waitFor(async () => {
        expect((await digest.projectWeek({ isoWeek: BASELINE_WEEK }))?.scenarios.runs).toBe(1);
        expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.scenarios.runs).toBe(1);
      });
      digest.world.hiddenFrom.set(MEMBER, [PROJECT]);

      await sendFor({ userId: MEMBER });
      await sendFor({ userId: OTHER_MEMBER });

      expect(digest.mail.map((mail) => mail.to)).toEqual([emailOf(OTHER_MEMBER)]);
      expect(digest.mail[0]?.props.rows).toEqual([
        expect.objectContaining({
          kind: "scenarios",
          direction: "worse",
          projectName: "Support bot",
        }),
      ]);
    });
  });
});
