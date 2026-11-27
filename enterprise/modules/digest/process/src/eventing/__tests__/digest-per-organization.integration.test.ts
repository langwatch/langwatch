// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The weekly send where a person sits in several organizations (one email each), where a picked
 * template cannot be built, where the person is deactivated, and where one organization cannot
 * be read.
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
  NEXT_WAKE_AT,
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

const arm = () => digest.repositories.audience.setArmed({ armed: true });

const sendIn = ({ userId, organizationId }: { userId: string; organizationId: string }) =>
  digest.carryOut({ userId, organizationId, isoWeek: SENT_WEEK });

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
  digest.world.organizations = [ORGANIZATION, OTHER_ORGANIZATION];
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

describe("a member of two organizations", () => {
  describe("when the week is planned and every send is handled", () => {
    /** @scenario "A member of two organizations is sent one email per organization" */
    it("sends one email per organization, each about that organization alone and naming it", async () => {
      await memberInBothOrganizations({ traces: { first: 1_200, second: 5_000 } });
      await digest.plan();
      const planned = (await asked(4)) as { userId: string; organizationId: string }[];

      for (const send of planned) await digest.carryOut(send);

      const ofMember = digest.mail.filter((mail) => mail.to === emailOf(MEMBER));
      const traces = ofMember.map((mail) => tracesOf(mail)).toSorted((a, b) => (a ?? 0) - (b ?? 0));
      const keys = ofMember
        .map((mail) => mail.idempotencyKey)
        .toSorted((a, b) => (a ?? "").localeCompare(b ?? ""));
      expect(traces).toEqual([1_200, 5_000]);
      expect(keys).toEqual([
        `digest:${MEMBER}:${ORGANIZATION}:${SENT_WEEK}`,
        `digest:${MEMBER}:${OTHER_ORGANIZATION}:${SENT_WEEK}`,
      ]);
      const subjects = ofMember.map((mail) => mail.email.subject);
      expect(new Set(subjects).size).toBe(2);
      expect(subjects.some((subject) => subject.startsWith("Acme: "))).toBe(true);
      expect(subjects.some((subject) => subject.startsWith(`Org ${OTHER_ORGANIZATION}: `))).toBe(
        true,
      );
      for (const organizationId of [ORGANIZATION, OTHER_ORGANIZATION]) {
        expect(
          await digest.repositories.sends.isSent({
            userId: MEMBER,
            organizationId,
            isoWeek: SENT_WEEK,
          }),
        ).toBe(true);
      }
    });
  });

  describe("when the same organization's send of the week is handled again", () => {
    /** @scenario "The resend of the same member, organization and week is dropped" */
    it("sends it once, and a second plan asks nothing more", async () => {
      await memberInBothOrganizations({ traces: { first: 1_200, second: 5_000 } });
      await digest.plan();
      const planned = (await asked(4)) as { userId: string; organizationId: string }[];
      const mine = planned.find(
        (send) => send.userId === MEMBER && send.organizationId === OTHER_ORGANIZATION,
      );

      await digest.carryOut(mine);
      await digest.carryOut(mine);
      await digest.plan({ at: NEXT_WAKE_AT, isoWeek: SENT_WEEK });

      expect(digest.mail.filter((mail) => mail.to === emailOf(MEMBER))).toHaveLength(1);
      expect(await digest.leaseSends()).toEqual([]);
    });
  });

  describe("when they opted out", () => {
    /** @scenario "An opted-out member receives none, in any organization" */
    it("sends them nothing from either organization", async () => {
      await memberInBothOrganizations({ traces: { first: 1_200, second: 5_000 } });
      await digest.repositories.audience.unsubscribe({
        userId: MEMBER,
        sendId: "settings",
        at: Date.now(),
      });

      for (const organizationId of [ORGANIZATION, OTHER_ORGANIZATION]) {
        await sendIn({ userId: MEMBER, organizationId });
      }

      expect(digest.mail.filter((mail) => mail.to === emailOf(MEMBER))).toEqual([]);
    });
  });

  describe("when they were removed from one organization", () => {
    /** @scenario "A member of two organizations is sent one email per organization" */
    it("sends the one they are still in", async () => {
      await memberInBothOrganizations({ traces: { first: 1_200, second: 5_000 } });
      digest.world.otherMembers = [];

      await sendIn({ userId: MEMBER, organizationId: ORGANIZATION });
      await sendIn({ userId: MEMBER, organizationId: OTHER_ORGANIZATION });

      expect(digest.mail.map((mail) => tracesOf(mail))).toEqual([1_200]);
    });
  });
});

describe("when the picked template cannot be built", () => {
  /** @scenario "A pick that cannot be built falls through to the next eligible template" */
  it("sends the next eligible template instead of nothing", async () => {
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
    await arm();
    digest.world.usage = { currentMonthMessagesCount: 900, maxMonthlyUsageLimit: 1_000 };
    digest.world.deactivated.add(ADMIN);

    await sendIn({ userId: ADMIN, organizationId: ORGANIZATION });

    expect(digest.mail).toEqual([]);
    expect(
      await digest.repositories.sends.isSent({
        userId: ADMIN,
        organizationId: ORGANIZATION,
        isoWeek: SENT_WEEK,
      }),
    ).toBe(false);
  });
});

describe("when one organization cannot be read", () => {
  beforeEach(async () => {
    // The failing one is listed first, so the ones after it show it does not stall them.
    digest.world.organizations = [OTHER_ORGANIZATION, ORGANIZATION];
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
  it("fails only its own plan, which the outbox retries without asking the rest twice", async () => {
    await digest.plan();
    await asked(3);
    expect(digest.world.failedPlans).toEqual([OTHER_ORGANIZATION]);
    expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBe(SENT_WEEK);

    digest.world.failingOrganizations.clear();
    digest.world.otherMembers = [{ userId: OTHER_MEMBER, role: "MEMBER", disabledAt: null }];
    await digest.planOrganization({ organizationId: OTHER_ORGANIZATION });

    expect(await asked(1)).toEqual([
      expect.objectContaining({ organizationId: OTHER_ORGANIZATION, userId: OTHER_MEMBER }),
    ]);
  });
});

describe("when the plan covers several organizations", () => {
  /** @scenario "Each organization is planned as its own intent, a page of ids at a time" */
  it("asks one plan per organization, however the ids are paged", async () => {
    digest.world.organizations = [ORGANIZATION, OTHER_ORGANIZATION, "org-3"];
    await arm();

    await digest.plan();

    expect(digest.world.requestedPlans).toBe(3);
    expect(digest.world.failedPlans).toEqual([]);
  });
});

describe("when a plan cannot ask for one organization or one member", () => {
  beforeEach(async () => {
    digest.world.organizations = [OTHER_ORGANIZATION, ORGANIZATION];
    await arm();
  });

  /** @scenario "A plan keeps walking past a failure, then fails once so it retries" */
  it("asks the rest, fails the week's plan, leaves it unplanned, and a retry asks only what was missed", async () => {
    digest.world.failingPlanRequests.add(OTHER_ORGANIZATION);

    await expect(digest.plan()).rejects.toThrow("left 1 ask(s) unmade");

    expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBeNull();
    expect(await asked(3)).toEqual(
      Array(3).fill(expect.objectContaining({ organizationId: ORGANIZATION })),
    );

    digest.world.failingPlanRequests.clear();
    digest.world.otherMembers = [{ userId: OTHER_MEMBER, role: "MEMBER", disabledAt: null }];
    await digest.plan();

    expect(await asked(1)).toEqual([
      expect.objectContaining({ organizationId: OTHER_ORGANIZATION, userId: OTHER_MEMBER }),
    ]);
    expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBe(SENT_WEEK);
  });

  /** @scenario "A plan keeps walking past a failure, then fails once so it retries" */
  it("asks the other members of an organization, fails its plan, and a retry asks only the missed one", async () => {
    digest.world.failingSendRequests.add(ADMIN);
    const members = digest.world.members.length;

    await expect(digest.planOrganization({ organizationId: ORGANIZATION })).rejects.toThrow(
      "left 1 ask(s) unmade",
    );
    expect(await asked(members - 1)).toHaveLength(members - 1);

    digest.world.failingSendRequests.clear();
    await digest.planOrganization({ organizationId: ORGANIZATION });

    expect(await asked(1)).toEqual([expect.objectContaining({ userId: ADMIN })]);
  });
});
