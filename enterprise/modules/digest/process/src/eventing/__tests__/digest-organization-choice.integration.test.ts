// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The weekly send where a person sits in several enrolled organizations, where a picked template
 * cannot be built, where the person is deactivated, and where one organization cannot be read.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderedDigestMail } from "../../channels/digest-mail.channel.ts";
import {
  ADMIN,
  emailOf,
  installDigest,
  type InstalledDigest,
  MEMBER,
  ORGANIZATION,
  OTHER_MEMBER,
  OTHER_ORGANIZATION,
  OTHER_PROJECT,
  PROJECT,
  SENT_WEEK,
} from "./digest.fixture.ts";

let digest: InstalledDigest;

beforeEach(() => {
  digest = installDigest();
});

afterEach(async () => {
  await digest.close();
});

const enrol = (organizationId: string) =>
  digest.repositories.audience.setEnrolled({ organizationId, enrolled: true, by: "operator-1" });
const arm = () => digest.repositories.audience.setArmed({ armed: true });

const sendIn = ({ userId, organizationId }: { userId: string; organizationId: string }) =>
  digest.carryOut({ userId, organizationId, isoWeek: SENT_WEEK, homeOrganizationId: null });

/** The week's trace count an email shows; only the traces-week template shows one. */
const tracesOf = (mail: RenderedDigestMail): number | undefined =>
  mail.templateId === "digest-traces-week" ? mail.props.traces : undefined;

/** The send intents asked so far, waited for since the plan's requests become intents async. */
async function asked(expected: number) {
  const seen: unknown[] = [];
  await vi.waitFor(async () => {
    for (const { payload } of await digest.leaseSends()) {
      seen.push(payload);
    }
    expect(seen).toHaveLength(expected);
  });
  return seen;
}

/** MEMBER sits in both organizations, each with a busy project. */
async function memberInBothOrganizations({
  traces,
}: {
  traces: Readonly<{ first: number; second: number }>;
}) {
  digest.world.otherMembers = [{ userId: MEMBER, role: "MEMBER", disabledAt: null }];
  await enrol(ORGANIZATION);
  await enrol(OTHER_ORGANIZATION);
  await arm();
  await digest.seedProjectWeek({
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    traces: traces.first,
  });
  await digest.seedProjectWeek({
    organizationId: OTHER_ORGANIZATION,
    projectId: OTHER_PROJECT,
    traces: traces.second,
  });
}

describe("a member of two enrolled organizations", () => {
  describe("when one organization's week was busier for them", () => {
    /** @scenario "A member of two enrolled organizations is sent the busier one's week" */
    it.each([
      ["the first one's send runs first", [ORGANIZATION, OTHER_ORGANIZATION]],
      ["the second one's send runs first", [OTHER_ORGANIZATION, ORGANIZATION]],
    ] as const)("sends only the busier one's email whichever order %s", async (_, order) => {
      await memberInBothOrganizations({ traces: { first: 1_200, second: 5_000 } });

      for (const organizationId of order) await sendIn({ userId: MEMBER, organizationId });

      expect(digest.mail.map((mail) => [mail.to, tracesOf(mail)])).toEqual([
        [emailOf(MEMBER), 5_000],
      ]);
    });
  });

  describe("when both organizations were equally busy", () => {
    /** @scenario "A member of two enrolled organizations is sent the busier one's week" */
    it("sends the one with the lowest organization id", async () => {
      await memberInBothOrganizations({ traces: { first: 2_000, second: 2_000 } });

      for (const organizationId of [OTHER_ORGANIZATION, ORGANIZATION]) {
        await sendIn({ userId: MEMBER, organizationId });
      }

      expect(digest.mail).toHaveLength(1);
      expect(ORGANIZATION < OTHER_ORGANIZATION).toBe(true);
      expect(await digest.repositories.sends.isSent({ userId: MEMBER, isoWeek: SENT_WEEK })).toBe(
        true,
      );
    });
  });

  describe("when they were removed from the busier organization", () => {
    /** @scenario "A member of two enrolled organizations is sent the busier one's week" */
    it("sends the one they are still in", async () => {
      await memberInBothOrganizations({ traces: { first: 1_200, second: 5_000 } });
      digest.world.otherMembers = [];

      await sendIn({ userId: MEMBER, organizationId: ORGANIZATION });

      expect(digest.mail.map((mail) => tracesOf(mail))).toEqual([1_200]);
    });
  });

  describe("when the ranking changes between the plan and the sends", () => {
    /** MEMBER's two planned send intents, by asking organization. */
    async function plannedSendsOfMember() {
      await digest.plan();
      const planned = (await asked(4)) as { userId: string; organizationId: string }[];
      const ofMember = (organizationId: string) =>
        planned.find((send) => send.userId === MEMBER && send.organizationId === organizationId);
      return { first: ofMember(ORGANIZATION), second: ofMember(OTHER_ORGANIZATION) };
    }

    /** @scenario "The home organization is chosen once, when the week is planned" */
    it("sends exactly one email, from the organization busier at plan time", async () => {
      await memberInBothOrganizations({ traces: { first: 5_000, second: 1_200 } });
      const { first, second } = await plannedSendsOfMember();
      expect([first, second]).toEqual([
        expect.objectContaining({ homeOrganizationId: ORGANIZATION }),
        expect.objectContaining({ homeOrganizationId: ORGANIZATION }),
      ]);

      // Ranked at send time, each send would answer "not me": the second before the change,
      // the first after it.
      await digest.carryOut(second);
      await digest.seedProjectWeek({
        organizationId: OTHER_ORGANIZATION,
        projectId: OTHER_PROJECT,
        traces: 9_000,
      });
      await digest.carryOut(first);

      expect(digest.mail.map((mail) => [mail.to, tracesOf(mail)])).toEqual([
        [emailOf(MEMBER), 5_000],
      ]);
    });

    /** @scenario "The home organization is chosen once, when the week is planned" */
    it("sends the other organization's email when they left the planned home", async () => {
      await memberInBothOrganizations({ traces: { first: 1_200, second: 5_000 } });
      const { first } = await plannedSendsOfMember();
      expect(first).toEqual(expect.objectContaining({ homeOrganizationId: OTHER_ORGANIZATION }));
      digest.world.otherMembers = [];

      await digest.carryOut(first);

      expect(digest.mail.map((mail) => [mail.to, tracesOf(mail)])).toEqual([
        [emailOf(MEMBER), 1_200],
      ]);
    });
  });
});

describe("when the picked template cannot be built", () => {
  /** @scenario "A pick that cannot be built falls through to the next eligible template" */
  it("sends the next eligible template instead of nothing", async () => {
    await enrol(ORGANIZATION);
    await arm();
    // The admin is eligible for plan-pressure first, which needs a name the module lacks.
    digest.world.usage = { currentMonthMessagesCount: 900, maxMonthlyUsageLimit: 1_000 };
    digest.world.unnamedOrganizations.add(ORGANIZATION);
    await digest.seedProjectWeek({
      organizationId: ORGANIZATION,
      projectId: PROJECT,
      traces: 1_200,
    });

    await sendIn({ userId: ADMIN, organizationId: ORGANIZATION });

    expect(digest.mail.map((mail) => mail.templateId)).toEqual(["digest-traces-week"]);
  });
});

describe("when a member's profile is deactivated", () => {
  /** @scenario "A deactivated person is sent nothing" */
  it("mails them nothing and records no send", async () => {
    await enrol(ORGANIZATION);
    await arm();
    digest.world.usage = { currentMonthMessagesCount: 900, maxMonthlyUsageLimit: 1_000 };
    digest.world.deactivated.add(ADMIN);

    await sendIn({ userId: ADMIN, organizationId: ORGANIZATION });

    expect(digest.mail).toEqual([]);
    expect(await digest.repositories.sends.isSent({ userId: ADMIN, isoWeek: SENT_WEEK })).toBe(
      false,
    );
  });
});

describe("when one enrolled organization cannot be read", () => {
  beforeEach(async () => {
    // The failing one is listed first: set order is enrolment order.
    await enrol(OTHER_ORGANIZATION);
    await enrol(ORGANIZATION);
    await arm();
    digest.world.failingOrganizations.add(OTHER_ORGANIZATION);
  });

  /** @scenario "One unreadable organization does not stall the others' plan" */
  it("still asks the sends of the organizations after it", async () => {
    await digest.plan();

    const planned = await asked(3);
    expect(planned).toEqual(
      Array(3).fill(expect.objectContaining({ organizationId: ORGANIZATION })),
    );
  });

  /** @scenario "One unreadable organization does not stall the others' plan" */
  it("leaves the week unplanned so the next wake retries it, without asking the rest twice", async () => {
    await digest.plan();
    await asked(3);
    expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBeNull();

    digest.world.failingOrganizations.clear();
    digest.world.otherMembers = [{ userId: OTHER_MEMBER, role: "MEMBER", disabledAt: null }];
    await digest.plan();

    // Only the organization that failed is asked now; the first one's requests are deduped.
    expect(await asked(1)).toEqual([
      expect.objectContaining({ organizationId: OTHER_ORGANIZATION, userId: OTHER_MEMBER }),
    ]);
    expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBe(SENT_WEEK);
  });
});
