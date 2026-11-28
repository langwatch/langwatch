// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The weekly digest over its memory twins: the real fold and send pipelines on in-memory
 * stores, the hourly plan and each member's send carried out as the outbox would, the mail
 * channel's memory tier recording each email instead of our mailer sending it.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { createHmac } from "node:crypto";

import type { DigestTokenCall } from "@langwatch/enterprise-digest-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isoWeekOf } from "../../rules/digest-week.rules.ts";
import {
  ATTEMPT_LIMITS,
  LINK_LIFETIME_SECONDS,
} from "../../services/digest-unsubscribe.service.ts";
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
/** An instant inside the sent week. */
const IN_SENT_WEEK = Date.parse("2026-11-11T12:00:00Z");
/** An hour of the Monday the sent week's email goes out, 2026-W47's first day. */
const mondayAt = (hour: number) => Date.UTC(2026, 10, 16, hour);
const DAY_MS = 24 * 60 * 60 * 1000;
/** The address the public pages count a caller as. */
const CALLER = "203.0.113.7";

let digest: InstalledDigest;

beforeEach(() => {
  digest = installDigest();
});

afterEach(async () => {
  await digest.close();
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
  digest.carryOut({ userId, organizationId: ORGANIZATION, isoWeek });

/** Each send carried out in turn, as the outbox would. */
async function carryOutAll(payloads: readonly unknown[]): Promise<void> {
  for (const payload of payloads) await digest.carryOut(payload);
}

/** Every pending send, carried out once, as the outbox dispatches them. */
async function sendPlanned(): Promise<number> {
  const leased = await digest.leaseSends();
  await carryOutAll(leased.map((message) => message.payload));
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
    it("plans nothing and mails no one, even for an organization with members", async () => {
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

  describe("when the send is armed and an organization was never enrolled", () => {
    /** @scenario "An organization that was never enrolled is sent to" */
    it("mails its members all the same: there is no enrolment to ask for", async () => {
      await arm();
      everyoneNearTheLimit();

      await digest.plan();
      await sendPlanned();

      expect(recipients()).toEqual(MEMBERS.map(emailOf).toSorted());
      expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBe(SENT_WEEK);
    });
  });

  describe("when the send is armed and an organization has three members", () => {
    beforeEach(async () => {
      await arm();
      everyoneNearTheLimit();
    });

    /** @scenario "Each member gets one email a week" */
    it("mails each member once, however often the wake and the sends run", async () => {
      const planned = await planAndCollect({ expected: 3 });
      await carryOutAll(planned);
      await digest.plan({ at: NEXT_WAKE_AT });
      await carryOutAll(planned);
      await sendPlanned();

      expect(recipients()).toEqual(MEMBERS.map(emailOf).toSorted());
      for (const userId of MEMBERS) {
        const mail = digest.mail.find((sent) => sent.to === emailOf(userId));
        expect(mail).toMatchObject({
          templateId: "digest-plan-pressure",
          idempotencyKey: `digest:${userId}:${ORGANIZATION}:${SENT_WEEK}`,
          test: false,
          email: {
            to: emailOf(userId),
            idempotencyKey: `digest:${userId}:${ORGANIZATION}:${SENT_WEEK}`,
          },
        });
        expect(mail?.email.subject).not.toBe("");
        expect(mail?.email.html).not.toBe("");
        expect(
          await digest.repositories.sends.isSent({
            userId,
            organizationId: ORGANIZATION,
            isoWeek: SENT_WEEK,
          }),
        ).toBe(true);
      }
    });

    /** @scenario "Each member gets one email a week" */
    /** @scenario "The email's footer link opens the person's email preferences" */
    it("gives every email an RFC 8058 one-click unsubscribe, and a footer link to the email preferences page", async () => {
      await carryOutAll(await planAndCollect({ expected: 3 }));

      expect(digest.mail).toHaveLength(3);
      for (const mail of digest.mail) {
        expect(mail.oneClickUnsubscribeUrl).toMatch(
          new RegExp(`^${BASE_URL}/api/digest/unsubscribe\\?token=.+`),
        );
        expect(mail.props.preferencesUrl).toBe(`${BASE_URL}/settings/profile#email-preferences`);
        expect(mail.email.unsubscribe).toEqual({ url: mail.oneClickUnsubscribeUrl });
      }
    });
  });

  describe("when an organization has more members than one page of its roster", () => {
    /** @scenario "Each member gets one email a week" */
    it("reads every page and stops after the short last one", async () => {
      // One past the 500-member page: the second page holds a single member.
      digest.world.members = Array.from({ length: 501 }, (_, index) => ({
        userId: `member-${index}`,
        role: "MEMBER",
        disabledAt: null,
      }));

      const members = await digest.members({ organizationId: ORGANIZATION });

      expect(members).toHaveLength(501);
      expect(members.at(-1)).toEqual({ userId: "member-500", admin: false });
    });
  });

  describe("when the send is armed early on Monday, before 08:00 UTC", () => {
    beforeEach(async () => {
      await arm();
      everyoneNearTheLimit();
    });

    /** @scenario "Arming before Monday 08:00 UTC sends last week once, from 08:00" */
    it("plans nothing until 08:00, then mails each member last week alone", async () => {
      for (const hour of [3, 4, 5, 6, 7]) {
        expect(await digest.wake({ at: mondayAt(hour) })).toBe(0);
      }
      expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBeNull();
      expect(await sendPlanned()).toBe(0);

      const planned = await planAndCollect({
        expected: 3,
        plan: () => digest.wake({ at: mondayAt(8) }),
      });
      await carryOutAll(planned);
      await digest.wake({ at: mondayAt(9) });
      await sendPlanned();

      const keys = digest.mail.map((mail) => mail.idempotencyKey ?? "");
      expect(keys.toSorted((left, right) => left.localeCompare(right))).toEqual(
        MEMBERS.map((userId) => `digest:${userId}:${ORGANIZATION}:${SENT_WEEK}`).toSorted(),
      );
    });

    /** @scenario "Arming before Monday 08:00 UTC sends last week once, from 08:00" */
    it("refuses a plan of any week but the one its slot may send", async () => {
      await digest.plan({ at: mondayAt(3), isoWeek: "2026-W45" });
      await digest.plan({ at: mondayAt(3), isoWeek: SENT_WEEK });
      await digest.plan({ at: WAKE_AT, isoWeek: "2026-W45" });

      expect((await digest.repositories.audience.getSettings()).lastPlannedWeek).toBeNull();
    });
  });

  describe("when the mailer fails after it accepted a member's email", () => {
    /** @scenario "A send retried after the mailer failed is not sent twice" */
    it("does not hand the email over again when the outbox retries", async () => {
      await arm();
      everyoneNearTheLimit();
      digest.mailChannel.failAfterAccepting();

      await expect(sendFor({ userId: MEMBER, isoWeek: SENT_WEEK })).rejects.toThrow(
        "the connection closed after the mailer accepted the email",
      );
      expect(
        await digest.repositories.sends.isSent({
          userId: MEMBER,
          organizationId: ORGANIZATION,
          isoWeek: SENT_WEEK,
        }),
      ).toBe(true);
      await sendFor({ userId: MEMBER, isoWeek: SENT_WEEK });

      expect(recipients()).toEqual([emailOf(MEMBER)]);
    });
  });

  describe("when a member's email cannot be rendered", () => {
    beforeEach(async () => {
      await arm();
      everyoneNearTheLimit();
    });

    /** @scenario "An email that cannot be rendered claims nothing and is sent on a retry" */
    it("fails the attempt without claiming the week, so the retry mails them once", async () => {
      // No scheme: neither the template's links nor notification's unsubscribe URL accept it.
      digest.world.publicBaseUrl = "app.example.test";

      await expect(sendFor({ userId: MEMBER, isoWeek: SENT_WEEK })).rejects.toThrow(/Invalid URL/);

      expect(digest.mail).toEqual([]);
      expect(
        await digest.repositories.sends.isSent({
          userId: MEMBER,
          organizationId: ORGANIZATION,
          isoWeek: SENT_WEEK,
        }),
      ).toBe(false);

      digest.world.publicBaseUrl = BASE_URL;
      await sendFor({ userId: MEMBER, isoWeek: SENT_WEEK });
      await sendFor({ userId: MEMBER, isoWeek: SENT_WEEK });

      expect(recipients()).toEqual([emailOf(MEMBER)]);
      expect(
        await digest.repositories.sends.isSent({
          userId: MEMBER,
          organizationId: ORGANIZATION,
          isoWeek: SENT_WEEK,
        }),
      ).toBe(true);
    });

    /** @scenario "A send without a public base URL is refused by name" */
    it("refuses by name with no public base URL, and records no send", async () => {
      digest.world.publicBaseUrl = "";

      await expect(sendFor({ userId: MEMBER, isoWeek: SENT_WEEK })).rejects.toMatchObject({
        code: "digest_public_base_url_missing",
        httpStatus: 503,
      });

      expect(digest.mail).toEqual([]);
      expect(
        await digest.repositories.sends.isSent({
          userId: MEMBER,
          organizationId: ORGANIZATION,
          isoWeek: SENT_WEEK,
        }),
      ).toBe(false);
    });
  });

  describe("when two attempts at one member's week run at once", () => {
    /** @scenario "A send retried after the mailer failed is not sent twice" */
    it("lets only the attempt that claimed the week send it", async () => {
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
      await arm();
      everyoneNearTheLimit();
      await digest.repositories.audience.unsubscribe({
        userId: MEMBER,
        sendId: `${MEMBER}:2026-W45`,
        at: WAKE_AT,
      });

      await carryOutAll(await planAndCollect({ expected: 3 }));

      expect(recipients()).toEqual([ADMIN, OTHER_MEMBER].map(emailOf).toSorted());
    });
  });

  describe("when the send is disarmed after its sends are planned", () => {
    /** @scenario "Disarming after the week is planned sends nothing more" */
    it("mails no one", async () => {
      await arm();
      everyoneNearTheLimit();
      const planned = await planAndCollect({ expected: 3 });

      await digest.repositories.audience.setArmed({ armed: false });
      await carryOutAll(planned);

      expect(digest.mail).toEqual([]);
    });
  });

  describe("when the organization is at 90% of its monthly limit", () => {
    /** @scenario "An organization admin near the plan limit is sent the plan's numbers" */
    it("mails its admin plan-pressure with the plan's numbers, and not its members", async () => {
      await arm();
      digest.world.usage = { currentMonthMessagesCount: 900, maxMonthlyUsageLimit: 1_000 };

      await carryOutAll(await planAndCollect({ expected: 3 }));

      expect(recipients()).toEqual([emailOf(ADMIN)]);
      expect(digest.mail[0]).toMatchObject({
        templateId: "digest-plan-pressure",
        props: { organizationName: "Acme", usagePercentage: 90, used: 900, limit: 1_000 },
      });
    });
  });

  describe("when a member had five coding-agent sessions in two repositories", () => {
    /** @scenario "A member with coding-agent sessions is sent their coding-agent week" */
    it("mails them coding-agent-week with their totals and busiest repository", async () => {
      await arm();
      const repositories = ["acme/api", "acme/web", "acme/api", "acme/web", "acme/api"];
      for (const [index, repository] of repositories.entries()) {
        await codingAgentFact({ sessionId: `session-${index}`, repository });
      }
      const metrics = {
        token_usage: 1_200,
        cost_usage: 2.5,
        active_time: 1_800,
        lines_of_code: 140,
        commit: 3,
        pull_request: 1,
      };
      for (const [metric, value] of Object.entries(metrics)) {
        await codingAgentFact({ sessionId: "session-0", series: { metric, value } });
      }
      await vi.waitFor(async () => {
        const week = await digest.userWeek({ isoWeek: SENT_WEEK, userId: MEMBER });
        expect(week?.sessions).toHaveLength(5);
        expect(Object.keys(week?.series ?? {})).toHaveLength(6);
      });

      await sendFor({ userId: MEMBER, isoWeek: SENT_WEEK });

      expect(recipients()).toEqual([emailOf(MEMBER)]);
      const [mail] = digest.mail;
      expect(mail?.templateId).toBe("digest-coding-agent-week");
      expect(mail?.props).toEqual({
        weekLabel: "Nov 9 to 15",
        preferencesUrl: `${BASE_URL}/settings/profile#email-preferences`,
        sessions: 5,
        tokens: 1_200,
        activeMinutes: 30,
        linesChanged: 140,
        commits: 3,
        pullRequests: 1,
        topRepo: "acme/api",
        weekUrl: BASE_URL,
      });
    });
  });

  describe("when a member's pick is the what's new fallback", () => {
    /** @scenario "A member whose pick has nothing to show this week is sent nothing" */
    it("mails them nothing and records no send, since no card is published", async () => {
      await arm();

      await carryOutAll(await planAndCollect({ expected: 3 }));

      expect(digest.mail).toEqual([]);
      expect(
        await digest.repositories.sends.isSent({
          userId: MEMBER,
          organizationId: ORGANIZATION,
          isoWeek: SENT_WEEK,
        }),
      ).toBe(false);
    });
  });

  describe("when a member has no address", () => {
    /** @scenario "A member with no email address is skipped" */
    it("mails them nothing", async () => {
      await arm();
      everyoneNearTheLimit();
      digest.world.users = [ADMIN, OTHER_MEMBER];

      await carryOutAll(await planAndCollect({ expected: 3 }));

      expect(recipients()).toEqual([ADMIN, OTHER_MEMBER].map(emailOf).toSorted());
    });
  });
});

describe("unsubscribing from the digest", () => {
  async function sentEmailOf(userId: string) {
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

      await digest.unsubscribes.unsubscribe({ token, callerAddress: CALLER });
      await digest.unsubscribes.unsubscribe({ token, callerAddress: CALLER });

      expect(await digest.unsubscribes.isSubscribed({ token, callerAddress: CALLER })).toBe(false);
      expect(digest.repositories.audience.unsubscribeSources().get(MEMBER)).toBe(
        `${MEMBER}:${ORGANIZATION}:${SENT_WEEK}`,
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
        const forgedCall = { token: forged, callerAddress: CALLER };
        await expect(digest.unsubscribes.isSubscribed(forgedCall)).rejects.toMatchObject({
          code: "digest_link_invalid",
        });
        await expect(digest.unsubscribes.unsubscribe(forgedCall)).rejects.toMatchObject({
          code: "digest_link_invalid",
        });
      }
      expect(await digest.repositories.audience.findUnsubscribed({ userIds: MEMBERS })).toEqual([]);
    });
  });

  describe("when the link has outlived its lifetime", () => {
    /** @scenario "An expired unsubscribe link is refused" */
    it("is honoured to its last day, then refused as an invalid link", async () => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);

      digest.world.clockOffsetMs = (LINK_LIFETIME_SECONDS - 24 * 60 * 60) * 1000;
      const call = { token, callerAddress: CALLER };
      expect(await digest.unsubscribes.isSubscribed(call)).toBe(true);

      digest.world.clockOffsetMs = LINK_LIFETIME_SECONDS * 1000;
      await expect(digest.unsubscribes.isSubscribed(call)).rejects.toMatchObject({
        code: "digest_link_invalid",
      });
      await expect(digest.unsubscribes.unsubscribe(call)).rejects.toMatchObject({
        code: "digest_link_invalid",
      });
      expect(await digest.repositories.audience.findUnsubscribed({ userIds: MEMBERS })).toEqual([]);
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
        digest.unsubscribes.isSubscribed({ token: signedAs(serialized), callerAddress: CALLER }),
      ).rejects.toMatchObject({ code: "digest_link_invalid" });
      expect(
        await digest.unsubscribes.isSubscribed({
          token: signedAs(`digest.v1:${serialized}`),
          callerAddress: CALLER,
        }),
      ).toBe(true);
    });
  });

  describe("when the person a valid link names no longer exists", () => {
    /** @scenario "A link for a person who no longer exists is refused as an invalid link" */
    it("is refused as an invalid link and writes no subscription", async () => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);
      digest.world.users = digest.world.users.filter((userId) => userId !== MEMBER);

      for (const call of [
        () => digest.unsubscribes.isSubscribed({ token, callerAddress: CALLER }),
        () => digest.unsubscribes.unsubscribe({ token, callerAddress: CALLER }),
        () => digest.unsubscribes.resubscribe({ token, callerAddress: CALLER }),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: "digest_link_invalid" });
      }
      expect(digest.repositories.audience.unsubscribeSources().has(MEMBER)).toBe(false);
    });
  });

  describe("when an unsubscribed member resubscribes from the same page", () => {
    /** @scenario "Resubscribing from the unsubscribe page" */
    it("sends them next week's email", async () => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);
      await digest.unsubscribes.unsubscribe({ token, callerAddress: CALLER });

      await digest.unsubscribes.resubscribe({ token, callerAddress: CALLER });
      await sendFor({ userId: MEMBER, isoWeek: "2026-W47" });

      expect(await digest.unsubscribes.isSubscribed({ token, callerAddress: CALLER })).toBe(true);
      expect(digest.mail.map((mail) => mail.idempotencyKey)).toEqual([
        `digest:${MEMBER}:${ORGANIZATION}:${SENT_WEEK}`,
        `digest:${MEMBER}:${ORGANIZATION}:2026-W47`,
      ]);
    });
  });

  describe("when one caller is past the limit", () => {
    type Action = keyof typeof ATTEMPT_LIMITS;
    const ACTIONS = Object.keys(ATTEMPT_LIMITS) as Action[];
    const OTHER_CALLER = "198.51.100.1";
    const attempts: Record<Action, (call: DigestTokenCall) => Promise<unknown>> = {
      resolve: (call) => digest.unsubscribes.isSubscribed(call),
      "one-click": (call) => digest.unsubscribes.unsubscribe(call),
      resubscribe: (call) => digest.unsubscribes.resubscribe(call),
    };
    /** One attempt with a forged token: refused as an invalid link, or as limited once past. */
    const forged = (action: Action, callerAddress: string | null) =>
      attempts[action]({ token: "junk", callerAddress });
    /** Spends a caller's whole window on forged tokens, which are refused and change nothing. */
    const exhaust = async (action: Action, callerAddress: string | null) => {
      for (let attempt = 0; attempt < ATTEMPT_LIMITS[action]; attempt += 1) {
        await expect(forged(action, callerAddress)).rejects.toMatchObject({
          code: "digest_link_invalid",
        });
      }
    };

    /** @scenario "The unsubscribe pages are rate limited, and a refused call touches nothing" */
    it.each(ACTIONS)("refuses %s past its cap, for that caller alone", async (action) => {
      await exhaust(action, CALLER);

      await expect(forged(action, CALLER)).rejects.toMatchObject({
        code: "digest_unsubscribe_rate_limited",
        httpStatus: 429,
      });
      await expect(forged(action, OTHER_CALLER)).rejects.toMatchObject({
        code: "digest_link_invalid",
      });
    });

    /** @scenario "The unsubscribe pages are rate limited, and a refused call touches nothing" */
    it("counts callers with no address in one shared bucket, not skipping the count", async () => {
      await exhaust("resolve", null);

      await expect(forged("resolve", null)).rejects.toMatchObject({
        code: "digest_unsubscribe_rate_limited",
      });
    });

    /** @scenario "The unsubscribe pages are rate limited, and a refused call touches nothing" */
    it.each(ACTIONS)("reads nothing on a refused %s call", async (action) => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);
      await exhaust(action, CALLER);
      // Had the call got past the count, a forged token and a token for a person who no longer
      // exists would each be refused as an invalid link: the signature check and the user read.
      digest.world.users = digest.world.users.filter((userId) => userId !== MEMBER);
      const subscriptionRead = vi.spyOn(digest.repositories.audience, "findUnsubscribed");

      for (const candidate of ["junk", token]) {
        await expect(
          attempts[action]({ token: candidate, callerAddress: CALLER }),
        ).rejects.toMatchObject({ code: "digest_unsubscribe_rate_limited" });
      }

      expect(subscriptionRead).not.toHaveBeenCalled();
    });

    /** @scenario "The unsubscribe pages are rate limited, and a refused call touches nothing" */
    it("records no unsubscribe on a refused one-click call", async () => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);
      await exhaust("one-click", CALLER);

      await expect(
        digest.unsubscribes.unsubscribe({ token, callerAddress: CALLER }),
      ).rejects.toMatchObject({ code: "digest_unsubscribe_rate_limited" });

      expect(digest.repositories.audience.unsubscribeSources().has(MEMBER)).toBe(false);
      expect(await digest.repositories.audience.findUnsubscribed({ userIds: MEMBERS })).toEqual([]);
    });

    /** @scenario "The unsubscribe pages are rate limited, and a refused call touches nothing" */
    it("leaves the member unsubscribed on a refused resubscribe call", async () => {
      const token = tokenOf((await sentEmailOf(MEMBER)).oneClickUnsubscribeUrl);
      await digest.unsubscribes.unsubscribe({ token, callerAddress: OTHER_CALLER });
      await exhaust("resubscribe", CALLER);

      await expect(
        digest.unsubscribes.resubscribe({ token, callerAddress: CALLER }),
      ).rejects.toMatchObject({ code: "digest_unsubscribe_rate_limited" });

      expect(await digest.repositories.audience.findUnsubscribed({ userIds: MEMBERS })).toEqual([
        MEMBER,
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
    await arm();
    everyoneNearTheLimit();

    await expect(sendFor({ userId: MEMBER, isoWeek: SENT_WEEK })).rejects.toMatchObject({
      code: "digest_links_unavailable",
    });

    expect(digest.mail).toEqual([]);
    expect(
      await digest.repositories.sends.isSent({
        userId: MEMBER,
        organizationId: ORGANIZATION,
        isoWeek: SENT_WEEK,
      }),
    ).toBe(false);
  });

  /** @scenario "Without a signing secret no link is signed or honoured" */
  it("refuses every link as unavailable, not as a server fault", async () => {
    const payload = Buffer.from(JSON.stringify({ u: MEMBER, s: "x", exp: 0 }));
    const token = `${payload.toString("base64url")}.${"0".repeat(64)}`;

    await expect(
      digest.unsubscribes.isSubscribed({ token, callerAddress: CALLER }),
    ).rejects.toMatchObject({
      code: "digest_links_unavailable",
      httpStatus: 503,
    });
    await expect(
      digest.unsubscribes.unsubscribe({ token, callerAddress: CALLER }),
    ).rejects.toMatchObject({
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
      expect(
        await digest.repositories.sends.isSent({
          userId: MEMBER,
          organizationId: ORGANIZATION,
          isoWeek: SENT_WEEK,
        }),
      ).toBe(false);
    });

    /** @scenario "A test email's unsubscribe link names the operator, not the member" */
    it("signs its unsubscribe for the operator, never the member", async () => {
      everyoneNearTheLimit();
      await digest.sendTest({ organizationId: ORGANIZATION, userId: MEMBER, operatorId: OPERATOR });
      const token = tokenOf(digest.mail[0]?.oneClickUnsubscribeUrl ?? "");

      await digest.unsubscribes.unsubscribe({ token, callerAddress: CALLER });

      expect(
        await digest.repositories.audience.findUnsubscribed({ userIds: [MEMBER, OPERATOR] }),
      ).toEqual([OPERATOR]);
    });
  });

  describe("when the member's pick has nothing to show", () => {
    /** @scenario "A test send of a member whose pick has nothing to show is refused" */
    it("is refused as nothing to send and mails no one", async () => {
      await expect(
        digest.sendTest({ organizationId: ORGANIZATION, userId: MEMBER, operatorId: OPERATOR }),
      ).rejects.toMatchObject({ code: "digest_nothing_to_send" });
      expect(digest.mail).toEqual([]);
    });
  });

  describe("when the person asked for is not a member", () => {
    /** @scenario "A test send of someone who is not a member is refused" */
    it("is refused as not found and mails no one", async () => {
      await expect(
        digest.sendTest({ organizationId: ORGANIZATION, userId: "stranger", operatorId: OPERATOR }),
      ).rejects.toMatchObject({ code: "digest_member_not_found" });
      expect(digest.mail).toEqual([]);
    });
  });

  describe("when the operator has no address to send to", () => {
    /** @scenario "A test send to an operator with no email address is refused" */
    it("is refused as an operator without an address and mails no one", async () => {
      everyoneNearTheLimit();

      await expect(
        digest.sendTest({ organizationId: ORGANIZATION, userId: MEMBER, operatorId: "ghost" }),
      ).rejects.toMatchObject({ code: "digest_operator_address_missing", httpStatus: 409 });
      expect(digest.mail).toEqual([]);
    });
  });

  describe("when the member opted out", () => {
    /** @scenario "A test send respects a member's opt-out" */
    it("is refused as opted out and mails no one", async () => {
      everyoneNearTheLimit();
      await digest.repositories.audience.unsubscribe({
        userId: MEMBER,
        sendId: `${MEMBER}:${ORGANIZATION}:${SENT_WEEK}`,
        at: WAKE_AT,
      });

      await expect(
        digest.sendTest({ organizationId: ORGANIZATION, userId: MEMBER, operatorId: OPERATOR }),
      ).rejects.toMatchObject({ code: "digest_member_unsubscribed", httpStatus: 409 });
      expect(digest.mail).toEqual([]);
    });
  });
});

describe("the digest fold", () => {
  describe("when the same evaluation completed event is delivered twice", () => {
    /** @scenario "A redelivered event is not counted twice" */
    it("counts the evaluation once in the project's week", async () => {
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
        const week = await digest.projectWeek({ isoWeek: SENT_WEEK });
        expect(week?.evaluators["langevals/exact_match"]?.runs).toBe(2);
      });
      expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.evaluators).toEqual({
        "langevals/exact_match": { runs: 2, passed: 2, failed: 0 },
      });
    });
  });

  describe("when a project's organization was never enrolled", () => {
    /** @scenario "A project of an organization that was never enrolled folds" */
    it("folds it, since every organization is in", async () => {
      await digest.evaluationCompleted({
        tenantId: PROJECT,
        projectId: PROJECT,
        occurredAt: IN_SENT_WEEK,
        evaluationId: "evaluation-1",
        passed: true,
      });

      await vi.waitFor(async () => {
        expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.evaluators.custom?.runs).toBe(1);
      });
    });
  });

  describe("when a project belongs to no organization", () => {
    /** @scenario "A project that belongs to no organization folds nothing" */
    it("folds nothing for it", async () => {
      await digest.evaluationCompleted({
        tenantId: "project-orphan",
        projectId: "project-orphan",
        occurredAt: IN_SENT_WEEK,
        evaluationId: "evaluation-1",
        passed: true,
      });
      await digest.evaluationCompleted({
        tenantId: PROJECT,
        projectId: PROJECT,
        occurredAt: IN_SENT_WEEK,
        evaluationId: "evaluation-2",
        passed: true,
      });

      await vi.waitFor(async () => {
        expect((await digest.projectWeek({ isoWeek: SENT_WEEK }))?.evaluators.custom?.runs).toBe(1);
      });
      expect(
        (
          await digest.repositories.projectWeeks.findWeeks({
            isoWeeks: [SENT_WEEK],
            organizationId: ORGANIZATION,
          })
        ).map((fold) => fold.projectId),
      ).toEqual([PROJECT]);
    });
  });

  describe("when the hourly plan runs", () => {
    /** @scenario "Weeks older than the sent week's baseline are swept" */
    it("keeps the sent week, the four its baseline reads and the current one", async () => {
      const weeks = ["2026-W41", "2026-W42", "2026-W43", "2026-W44", "2026-W45", "2026-W46"];
      const current = isoWeekOf(WAKE_AT);
      for (const [index, isoWeek] of [...weeks, current].entries()) {
        await digest.recordProject(scenarioIn({ isoWeek, sourceKey: `span-${index}` }));
      }
      await vi.waitFor(async () => {
        const kept = await digest.repositories.projectWeeks.findWeeks({
          isoWeeks: [...weeks, current],
          organizationId: ORGANIZATION,
        });
        expect(kept).toHaveLength(7);
      });

      await digest.plan();

      const kept = await digest.repositories.projectWeeks.findWeeks({
        isoWeeks: [...weeks, current],
        organizationId: ORGANIZATION,
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

/** One coding-agent fact on the member's sent week, through digest's own record command. */
function codingAgentFact({
  sessionId,
  repository = null,
  series = null,
}: {
  sessionId: string;
  repository?: string | null;
  series?: { metric: string; value: number } | null;
}) {
  return digest.recordUser({
    tenantId: PROJECT,
    occurredAt: IN_SENT_WEEK,
    organizationId: ORGANIZATION,
    isoWeek: SENT_WEEK,
    sourceKey: `${sessionId}:${series?.metric ?? "span"}`,
    userId: MEMBER,
    sessionId,
    repository,
    series: series && { seriesId: `${sessionId}:${series.metric}`, type: null, ...series },
  });
}

/** One passed scenario run on the project's week, through digest's own record command. */
function scenarioIn({ isoWeek, sourceKey }: { isoWeek: string; sourceKey: string }) {
  return {
    tenantId: PROJECT,
    occurredAt: IN_SENT_WEEK,
    projectId: PROJECT,
    organizationId: ORGANIZATION,
    isoWeek,
    sourceKey,
    fact: { kind: "scenario" as const, scenarioId: null, outcome: "passed" as const },
  };
}
