// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The weekly digest over its memory twins: the real fold and send pipelines on in-memory
 * stores, the hourly plan and each member's send carried out as the outbox would, the mail
 * channel's memory tier recording each email instead of our mailer sending it.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isoWeekOf } from "../../rules/digest-week.rules.ts";
import { LINK_LIFETIME_SECONDS } from "../../services/digest-unsubscribe.service.ts";
import {
  ADMIN,
  BASE_URL,
  DIGEST_SECRET,
  digestWorld,
  emailOf,
  installDigest,
  type InstalledDigest,
  MEMBER,
  NEXT_WAKE_AT,
  ORGANIZATION,
  OPERATOR,
  OTHER_MEMBER,
  PROJECT,
  SENT_WEEK,
  WAKE_AT,
} from "./digest.fixture.ts";

const MEMBERS = [ADMIN, MEMBER, OTHER_MEMBER];
/** Past how long a process may keep its view of the enrolled cohort. */
const COHORT_REFRESH_MS = 61 * 1000;
/** An instant inside the sent week. */
const IN_SENT_WEEK = Date.parse("2026-11-11T12:00:00Z");
/** An hour of the Monday the sent week's email goes out, 2026-W47's first day. */
const mondayAt = (hour: number) => Date.UTC(2026, 10, 16, hour);
const DAY_MS = 24 * 60 * 60 * 1000;

let digest: InstalledDigest;

beforeEach(() => {
  digest = installDigest();
});

afterEach(async () => {
  await digest.close();
});

const enrol = () =>
  digest.repositories.audience.setEnrolled({
    organizationId: ORGANIZATION,
    enrolled: true,
    by: "operator-1",
  });
const arm = () => digest.repositories.audience.setArmed({ armed: true });

/**
 * Every member an admin of an organization at 90% of its plan, so each one's pick is
 * plan-pressure, which always has something to show.
 */
function everyoneNearTheLimit() {
  digest.world.members = digest.world.members.map((member) => ({ ...member, role: "ADMIN" }));
  digest.world.usage = { currentMonthMessagesCount: 900, maxMonthlyUsageLimit: 1_000 };
}

const recipients = () => digest.mail.map((mail) => mail.to).toSorted();

/** The token the email's one-click unsubscribe carries. */
function tokenOf(oneClickUrl: string): string {
  return new URL(oneClickUrl).searchParams.get("token") ?? "";
}

/** One member's send for a week, carried out as the outbox would. */
const sendFor = ({ userId, isoWeek }: { userId: string; isoWeek: string }) =>
  digest.carryOut({ userId, organizationId: ORGANIZATION, isoWeek, admin: true, at: WAKE_AT });

/** Every pending send, carried out once, as the outbox dispatches them. */
async function sendPlanned(): Promise<number> {
  const leased = await digest.leaseSends();
  for (const message of leased) await digest.carryOut(message.payload);
  return leased.length;
}

/** Plans the week and waits until each member's ask has become a send intent. */
async function planAndCollect({
  at = WAKE_AT,
  expected,
  plan = () => digest.plan({ at }),
}: {
  at?: number;
  expected: number;
  plan?: () => Promise<unknown>;
}) {
  await plan();
  const seen: unknown[] = [];
  await vi.waitFor(async () => {
    seen.push(...(await digest.leaseSends()).map((message) => message.payload));
    expect(seen).toHaveLength(expected);
  });
  return seen;
}

describe("the weekly digest send", () => {
  describe("when the send is not armed", () => {
    /** @scenario "Nothing is sent while the send is disarmed" */
    it("plans nothing and mails no one, even for an enrolled organization", async () => {
      await enrol();
      everyoneNearTheLimit();

      await digest.plan();
      await digest.plan({ at: NEXT_WAKE_AT });

      expect(await sendPlanned()).toBe(0);
      expect(digest.mail).toEqual([]);
      expect(await digest.repositories.audience.getSettings()).toEqual({
        armed: false,
        lastPlannedWeek: null,
      });
    });
  });

  describe("when the send is armed but no organization is enrolled", () => {
    /** @scenario "Nothing is sent while no organization is enrolled" */
    it("mails no one", async () => {
      await arm();
      everyoneNearTheLimit();

      await digest.plan();

      expect(await sendPlanned()).toBe(0);
      expect(digest.mail).toEqual([]);
      expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBeNull();
    });
  });

  describe("when the send is armed and an organization with three members is enrolled", () => {
    /** @scenario "Each enrolled member gets one email a week" */
    it("mails each member once, however often the wake and the sends run", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();

      const planned = await planAndCollect({ expected: 3 });
      for (const payload of planned) await digest.carryOut(payload);
      await digest.plan({ at: NEXT_WAKE_AT });
      for (const payload of planned) await digest.carryOut(payload);
      await sendPlanned();

      expect(recipients()).toEqual(MEMBERS.map(emailOf).toSorted());
      for (const userId of MEMBERS) {
        const mail = digest.mail.find((sent) => sent.to === emailOf(userId));
        expect(mail).toMatchObject({
          templateId: "digest-plan-pressure",
          idempotencyKey: `digest:${userId}:${SENT_WEEK}`,
          test: false,
        });
        expect(await digest.repositories.sends.isSent({ userId, isoWeek: SENT_WEEK })).toBe(true);
      }
    });

    /** @scenario "Each enrolled member gets one email a week" */
    it("gives every email an RFC 8058 one-click unsubscribe, the same address its footer opens", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();

      for (const payload of await planAndCollect({ expected: 3 })) await digest.carryOut(payload);

      for (const mail of digest.mail) {
        expect(mail.oneClickUnsubscribeUrl).toMatch(
          new RegExp(`^${BASE_URL}/api/digest/unsubscribe\\?token=.+`),
        );
        expect(mail.props.unsubscribeUrl).toBe(mail.oneClickUnsubscribeUrl);
      }
    });
  });

  describe("when the send is armed early on Monday, before 08:00 UTC", () => {
    /** @scenario "Arming before Monday 08:00 UTC sends last week once, from 08:00" */
    it("plans nothing until 08:00, then mails each member last week alone", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();

      for (const hour of [3, 4, 5, 6, 7]) {
        expect(await digest.wake({ at: mondayAt(hour) })).toBe(0);
      }
      expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBeNull();
      expect(await sendPlanned()).toBe(0);

      const planned = await planAndCollect({
        expected: 3,
        plan: () => digest.wake({ at: mondayAt(8) }),
      });
      for (const payload of planned) await digest.carryOut(payload);
      await digest.wake({ at: mondayAt(9) });
      await sendPlanned();

      expect(digest.mail.map((mail) => mail.idempotencyKey).toSorted()).toEqual(
        MEMBERS.map((userId) => `digest:${userId}:${SENT_WEEK}`).toSorted(),
      );
    });

    /** @scenario "Arming before Monday 08:00 UTC sends last week once, from 08:00" */
    it("refuses a plan of any week but the one its slot may send", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();

      await digest.plan({ at: mondayAt(3), isoWeek: "2026-W45" });
      await digest.plan({ at: mondayAt(3), isoWeek: SENT_WEEK });
      await digest.plan({ at: WAKE_AT, isoWeek: "2026-W45" });

      expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBeNull();
    });
  });

  describe("when the mailer fails after it accepted a member's email", () => {
    /** @scenario "A send retried after the mailer failed is not sent twice" */
    it("does not hand the email over again when the outbox retries", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();
      digest.mailChannel.failAfterAccepting();

      await expect(sendFor({ userId: MEMBER, isoWeek: SENT_WEEK })).rejects.toThrow();
      await sendFor({ userId: MEMBER, isoWeek: SENT_WEEK });

      expect(recipients()).toEqual([emailOf(MEMBER)]);
    });
  });

  describe("when two attempts at one member's week run at once", () => {
    /** @scenario "A send retried after the mailer failed is not sent twice" */
    it("lets only the attempt that claimed the week send it", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();

      await Promise.all([
        sendFor({ userId: MEMBER, isoWeek: SENT_WEEK }),
        sendFor({ userId: MEMBER, isoWeek: SENT_WEEK }),
      ]);

      expect(recipients()).toEqual([emailOf(MEMBER)]);
    });
  });

  describe("when a member opted out of the digest", () => {
    /** @scenario "An unsubscribed member is skipped" */
    it("mails everyone but them", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();
      await digest.repositories.audience.unsubscribe({
        userId: MEMBER,
        sendId: `${MEMBER}:2026-W45`,
        at: WAKE_AT,
      });

      for (const payload of await planAndCollect({ expected: 3 })) await digest.carryOut(payload);

      expect(recipients()).toEqual([ADMIN, OTHER_MEMBER].map(emailOf).toSorted());
    });
  });

  describe("when the organization is unenrolled after its sends are planned", () => {
    /** @scenario "A member of an organization unenrolled after planning is skipped" */
    it("mails none of its members", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();
      const planned = await planAndCollect({ expected: 3 });

      await digest.repositories.audience.setEnrolled({
        organizationId: ORGANIZATION,
        enrolled: false,
        by: "operator-1",
      });
      for (const payload of planned) await digest.carryOut(payload);

      expect(digest.mail).toEqual([]);
    });
  });

  describe("when the send is disarmed after its sends are planned", () => {
    /** @scenario "Disarming after the week is planned sends nothing more" */
    it("mails no one", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();
      const planned = await planAndCollect({ expected: 3 });

      await digest.repositories.audience.setArmed({ armed: false });
      for (const payload of planned) await digest.carryOut(payload);

      expect(digest.mail).toEqual([]);
    });
  });

  describe("when the organization is at 90% of its monthly limit", () => {
    /** @scenario "An organization admin near the plan limit is sent the plan's numbers" */
    it("mails its admin plan-pressure with the plan's numbers, and not its members", async () => {
      await enrol();
      await arm();
      digest.world.usage = { currentMonthMessagesCount: 900, maxMonthlyUsageLimit: 1_000 };

      for (const payload of await planAndCollect({ expected: 3 })) await digest.carryOut(payload);

      expect(recipients()).toEqual([emailOf(ADMIN)]);
      expect(digest.mail[0]).toMatchObject({
        templateId: "digest-plan-pressure",
        props: { organizationName: "Acme", usagePercentage: 90, used: 900, limit: 1_000 },
      });
    });
  });

  describe("when a member's pick is the what's new fallback", () => {
    /** @scenario "A member whose pick has nothing to show this week is sent nothing" */
    it("mails them nothing and records no send, since no card is published", async () => {
      await enrol();
      await arm();

      for (const payload of await planAndCollect({ expected: 3 })) await digest.carryOut(payload);

      expect(digest.mail).toEqual([]);
      expect(await digest.repositories.sends.isSent({ userId: MEMBER, isoWeek: SENT_WEEK })).toBe(
        false,
      );
    });
  });

  describe("when a member has no address", () => {
    it("mails them nothing", async () => {
      await enrol();
      await arm();
      everyoneNearTheLimit();
      digest.world.users = [ADMIN, OTHER_MEMBER];

      for (const payload of await planAndCollect({ expected: 3 })) await digest.carryOut(payload);

      expect(recipients()).toEqual([ADMIN, OTHER_MEMBER].map(emailOf).toSorted());
    });
  });
});

describe("unsubscribing from the digest", () => {
  async function sentEmailOf(userId: string) {
    await enrol();
    await arm();
    everyoneNearTheLimit();
    await sendFor({ userId, isoWeek: SENT_WEEK });
    const mail = digest.mail.find((sent) => sent.to === emailOf(userId));
    if (!mail) throw new Error(`${userId} was sent no email`);
    return mail;
  }

  describe("when a POST with the token from a sent email arrives", () => {
    /** @scenario "One-click unsubscribe from the mail client" */
    it("opts the member out, records the send it came from, and skips next week", async () => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);

      await digest.unsubscribes.unsubscribe({ token });
      await digest.unsubscribes.unsubscribe({ token });

      expect(await digest.unsubscribes.isSubscribed({ token })).toBe(false);
      expect(digest.repositories.audience.unsubscribedFrom({ userId: MEMBER })).toBe(
        `${MEMBER}:${SENT_WEEK}`,
      );
      await sendFor({ userId: MEMBER, isoWeek: "2026-W47" });
      expect(digest.mail).toHaveLength(1);
    });
  });

  describe("when the token's signature does not match", () => {
    /** @scenario "A forged or tampered unsubscribe token is refused" */
    it("is refused as an invalid link and changes no subscription", async () => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);
      const [payload = "", signature = ""] = token.split(".");
      const forgedFor = Buffer.from(JSON.stringify({ u: ADMIN, s: "x" })).toString("base64url");

      for (const forged of [`${forgedFor}.${signature}`, `${payload}.${"0".repeat(64)}`, "junk"]) {
        await expect(digest.unsubscribes.isSubscribed({ token: forged })).rejects.toMatchObject({
          code: "digest_link_invalid",
        });
        await expect(digest.unsubscribes.unsubscribe({ token: forged })).rejects.toMatchObject({
          code: "digest_link_invalid",
        });
      }
      expect(await digest.repositories.audience.listUnsubscribed({ userIds: MEMBERS })).toEqual([]);
    });
  });

  describe("when the link has outlived its lifetime", () => {
    /** @scenario "An expired unsubscribe link is refused" */
    it("is honoured to its last day, then refused as an invalid link", async () => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);

      digest.world.clockOffsetMs = (LINK_LIFETIME_SECONDS - 24 * 60 * 60) * 1000;
      expect(await digest.unsubscribes.isSubscribed({ token })).toBe(true);

      digest.world.clockOffsetMs = LINK_LIFETIME_SECONDS * 1000;
      await expect(digest.unsubscribes.isSubscribed({ token })).rejects.toMatchObject({
        code: "digest_link_invalid",
      });
      await expect(digest.unsubscribes.unsubscribe({ token })).rejects.toMatchObject({
        code: "digest_link_invalid",
      });
      expect(await digest.repositories.audience.listUnsubscribed({ userIds: MEMBERS })).toEqual([]);
    });
  });

  describe("when a token is signed with the same secret for another purpose", () => {
    /** @scenario "A forged or tampered unsubscribe token is refused" */
    it("is refused; only the digest's own purpose verifies", async () => {
      const serialized = JSON.stringify({
        u: MEMBER,
        s: "x",
        exp: Math.floor((Date.now() + DAY_MS) / 1000),
      });
      const signedAs = (bytes: string) =>
        `${Buffer.from(serialized).toString("base64url")}.${createHmac("sha256", DIGEST_SECRET)
          .update(bytes)
          .digest("hex")}`;

      await expect(
        digest.unsubscribes.isSubscribed({ token: signedAs(serialized) }),
      ).rejects.toMatchObject({ code: "digest_link_invalid" });
      expect(
        await digest.unsubscribes.isSubscribed({ token: signedAs(`digest.v1:${serialized}`) }),
      ).toBe(true);
    });
  });

  describe("when an unsubscribed member resubscribes from the same page", () => {
    /** @scenario "Resubscribing from the unsubscribe page" */
    it("sends them next week's email", async () => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);
      await digest.unsubscribes.unsubscribe({ token });

      await digest.unsubscribes.resubscribe({ token });
      await sendFor({ userId: MEMBER, isoWeek: "2026-W47" });

      expect(await digest.unsubscribes.isSubscribed({ token })).toBe(true);
      expect(digest.mail.map((mail) => mail.idempotencyKey)).toEqual([
        `digest:${MEMBER}:${SENT_WEEK}`,
        `digest:${MEMBER}:2026-W47`,
      ]);
    });
  });
});

describe("when no signing secret is configured", () => {
  beforeEach(async () => {
    await digest.close();
    digest = installDigest(digestWorld(), { secret: "" });
  });

  /** @scenario "Without a signing secret no link is signed or honoured" */
  it("sends no member their week, and records no send", async () => {
    await enrol();
    await arm();
    everyoneNearTheLimit();

    await expect(sendFor({ userId: MEMBER, isoWeek: SENT_WEEK })).rejects.toMatchObject({
      code: "digest_links_unavailable",
    });

    expect(digest.mail).toEqual([]);
    expect(await digest.repositories.sends.isSent({ userId: MEMBER, isoWeek: SENT_WEEK })).toBe(
      false,
    );
  });

  /** @scenario "Without a signing secret no link is signed or honoured" */
  it("refuses every link as unavailable, not as a server fault", async () => {
    const payload = Buffer.from(JSON.stringify({ u: MEMBER, s: "x", exp: 0 }));
    const token = `${payload.toString("base64url")}.${"0".repeat(64)}`;

    await expect(digest.unsubscribes.isSubscribed({ token })).rejects.toMatchObject({
      code: "digest_links_unavailable",
      httpStatus: 503,
    });
    await expect(digest.unsubscribes.unsubscribe({ token })).rejects.toMatchObject({
      code: "digest_links_unavailable",
    });
  });
});

describe("an operator's test send", () => {
  describe("when an operator asks for a member's email", () => {
    /** @scenario "Sending a test goes only to the operator" */
    it("mails the operator alone, marked as a test, and records no send", async () => {
      everyoneNearTheLimit();

      await digest.sendTest({ organizationId: ORGANIZATION, userId: MEMBER, operatorId: OPERATOR });

      expect(digest.mail).toHaveLength(1);
      const [mail] = digest.mail;
      expect(mail).toMatchObject({
        to: emailOf(OPERATOR),
        templateId: "digest-plan-pressure",
        test: true,
      });
      expect(mail?.idempotencyKey).toBeUndefined();
      expect(await digest.repositories.sends.isSent({ userId: MEMBER, isoWeek: SENT_WEEK })).toBe(
        false,
      );
    });

    it("signs its unsubscribe for the operator, never the member", async () => {
      everyoneNearTheLimit();
      await digest.sendTest({ organizationId: ORGANIZATION, userId: MEMBER, operatorId: OPERATOR });
      const token = tokenOf(digest.mail[0]?.oneClickUnsubscribeUrl ?? "");

      await digest.unsubscribes.unsubscribe({ token });

      expect(
        await digest.repositories.audience.listUnsubscribed({ userIds: [MEMBER, OPERATOR] }),
      ).toEqual([OPERATOR]);
    });
  });

  describe("when the member's pick has nothing to show", () => {
    it("is refused as nothing to send and mails no one", async () => {
      await expect(
        digest.sendTest({ organizationId: ORGANIZATION, userId: MEMBER, operatorId: OPERATOR }),
      ).rejects.toMatchObject({ code: "digest_nothing_to_send" });
      expect(digest.mail).toEqual([]);
    });
  });

  describe("when the person asked for is not a member", () => {
    it("is refused as not found and mails no one", async () => {
      await expect(
        digest.sendTest({ organizationId: ORGANIZATION, userId: "stranger", operatorId: OPERATOR }),
      ).rejects.toMatchObject({ code: "digest_member_not_found" });
      expect(digest.mail).toEqual([]);
    });
  });
});

describe("the digest fold", () => {
  describe("when the same evaluation completed event is delivered twice", () => {
    /** @scenario "A redelivered event is not counted twice" */
    it("counts the evaluation once in the project's week", async () => {
      await enrol();
      const evaluation = (evaluationId: string) => ({
        tenantId: PROJECT,
        projectId: PROJECT,
        occurredAt: IN_SENT_WEEK,
        evaluationId,
        evaluatorType: "langevals/exact_match",
        passed: true,
      });

      await digest.evaluationCompleted(evaluation("evaluation-1"));
      await digest.evaluationCompleted(evaluation("evaluation-1"));
      await digest.evaluationCompleted(evaluation("evaluation-2"));

      await vi.waitFor(async () => {
        expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.evaluations.runs).toBe(2);
      });
      expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.evaluators).toEqual({
        "langevals/exact_match": { runs: 2, passed: 2, failed: 0 },
      });
    });
  });

  describe("when a project's organization is not enrolled", () => {
    /** @scenario "A project of an organization not enrolled folds nothing" */
    it("folds nothing for it until it is", async () => {
      await digest.evaluationCompleted({
        tenantId: PROJECT,
        projectId: PROJECT,
        occurredAt: IN_SENT_WEEK,
        evaluationId: "evaluation-1",
        passed: true,
      });
      await enrol();
      digest.world.clockOffsetMs = COHORT_REFRESH_MS;
      await digest.evaluationCompleted({
        tenantId: PROJECT,
        projectId: PROJECT,
        occurredAt: IN_SENT_WEEK,
        evaluationId: "evaluation-2",
        passed: true,
      });

      await vi.waitFor(async () => {
        expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.evaluations.runs).toBe(1);
      });
    });
  });

  describe("when the hourly plan runs", () => {
    /** @scenario "Weeks older than the sent week's baseline are swept" */
    it("keeps the sent week, the four its baseline reads and the current one", async () => {
      const weeks = ["2026-W41", "2026-W42", "2026-W43", "2026-W44", "2026-W45", "2026-W46"];
      const current = isoWeekOf(WAKE_AT);
      for (const [index, isoWeek] of [...weeks, current].entries()) {
        await digest.recordProject(spanIn({ isoWeek, sourceKey: `span-${index}` }));
      }
      await vi.waitFor(async () => {
        const kept = await digest.repositories.projectWeeks.listWeeks({
          isoWeeks: [...weeks, current],
        });
        expect(kept).toHaveLength(7);
      });

      await digest.plan();

      const kept = await digest.repositories.projectWeeks.listWeeks({
        isoWeeks: [...weeks, current],
      });
      expect(kept.map((fold) => fold.isoWeek).toSorted()).toEqual([
        "2026-W42",
        "2026-W43",
        "2026-W44",
        "2026-W45",
        "2026-W46",
        "2026-W47",
      ]);
    });
  });
});

/** One root span on the project's week, through digest's own record command. */
function spanIn({
  isoWeek,
  sourceKey,
  error = false,
  model = null,
}: {
  isoWeek: string;
  sourceKey: string;
  error?: boolean;
  model?: string | null;
}) {
  return {
    tenantId: PROJECT,
    occurredAt: IN_SENT_WEEK,
    projectId: PROJECT,
    organizationId: ORGANIZATION,
    isoWeek,
    sourceKey,
    fact: {
      kind: "span" as const,
      root: true,
      error,
      tokens: 15,
      costUsd: 0.5,
      durationMs: 80,
      model,
    },
  };
}
