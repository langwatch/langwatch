import type { KnownBlock } from "@slack/types";
import { describe, expect, it } from "vitest";

import { NOTICE_TONES, type RegisteredNotice, type SlackNoticeMessage } from "../../notice.ts";
import {
  billingThresholdFailureNotice,
  licensePurchaseNotice,
  newOrganizationNotice,
  newUserNotice,
  planLimitReachedNotice,
  resourceLimitReachedNotice,
  scimSyncSummaryNotice,
  selfHostedSignalNotice,
  slackNotices,
  subscriptionActivatedNotice,
  subscriptionCancelledNotice,
  subscriptionProspectiveNotice,
} from "../index.ts";

const origin = { environment: "app.langwatch.ai", sentAt: 1_790_000_000_000 };
const TONE_EMOJI = Object.values(NOTICE_TONES);

const headerOf = (message: SlackNoticeMessage): string => {
  const header = message.blocks[0];
  if (header?.type === "card" && header.title) return header.title.text;
  if (header?.type !== "header") throw new Error("expected the first block to be a header");
  return header.text.text;
};

const cardOf = (message: SlackNoticeMessage) => {
  const card = message.blocks[0];
  if (card?.type !== "card") throw new Error("expected the first block to be a card");
  return card;
};

const fieldLabelsOf = (message: SlackNoticeMessage): string[] =>
  message.blocks.flatMap((block: KnownBlock) =>
    block.type === "section" && block.fields
      ? block.fields.map((field) => field.text.split("\n")[0]?.replaceAll("*", "") ?? "")
      : [],
  );

const buttonUrlsOf = (message: SlackNoticeMessage): string[] =>
  message.blocks.flatMap((block) => {
    if (block.type === "card") return (block.actions ?? []).flatMap((b) => (b.url ? [b.url] : []));
    if (block.type !== "actions") return [];
    return block.elements.flatMap((element) =>
      element.type === "button" && element.url ? [element.url] : [],
    );
  });

const urlsIn = (props: unknown): string[] =>
  typeof props === "object" && props !== null
    ? Object.entries(props)
        .filter(([key]) => key !== "appUrl")
        .map(([, value]) => value)
        .filter(
          (value): value is string => typeof value === "string" && value.startsWith("https://"),
        )
    : [];

describe("given the Slack notice registry", () => {
  it("gives every notice a unique identifier", () => {
    const ids = slackNotices.map((notice) => notice.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every notice at least one fixture", () => {
    for (const notice of slackNotices) expect(notice.fixtures.length).toBeGreaterThan(0);
  });

  describe.each(
    slackNotices.flatMap((notice) =>
      notice.fixtures.map((fixture) => ({
        notice,
        fixture,
        label: `${notice.id} / ${fixture.name}`,
      })),
    ),
  )("when $label is rendered", ({ notice, fixture }) => {
    const message = notice.renderUnknown({ props: fixture.props, origin });

    /** @scenario "Every notice renders from each of its fixtures" */
    it("matches its stored rendering", () => {
      expect(message).toMatchSnapshot();
    });

    /** @scenario "Every notice opens with one status emoji in its header" */
    /** @scenario "A card notice opens its title with one status emoji" */
    it("opens its header with exactly one status emoji", () => {
      const header = headerOf(message);
      expect(TONE_EMOJI.filter((emoji) => header.startsWith(`${emoji} `))).toHaveLength(1);
      expect(TONE_EMOJI.filter((emoji) => header.includes(emoji))).toHaveLength(1);
    });

    it("carries a plain-text fallback led by its header", () => {
      expect(message.text.startsWith(headerOf(message))).toBe(true);
    });

    it("ends with where and when it was sent", () => {
      const footer = message.blocks.at(-1);
      expect(footer?.type).toBe("context");
      expect(JSON.stringify(footer)).toContain("app.langwatch.ai");
    });

    /** @scenario "Every link the props carry becomes a button" */
    it("turns every link in its props into a button", () => {
      expect(buttonUrlsOf(message)).toEqual(expect.arrayContaining(urlsIn(fixture.props)));
    });
  });
});

const render = ({ notice, props }: { notice: RegisteredNotice; props: unknown }) =>
  notice.renderUnknown({ props, origin });

describe("the new-organisation notice", () => {
  const [campaign, bare] = newOrganizationNotice.fixtures;

  /** @scenario "A new organisation's card names who created it and where" */
  it("names the organisation, the person, their campaign and phone", () => {
    const card = cardOf(render({ notice: newOrganizationNotice, props: campaign?.props }));
    expect(card.title?.text).toBe("🏢 Acme Robotics · new organisation");
    expect(card.subtitle?.text).toBe("Morgan Ellis · morgan.ellis@acme.example");
    expect(card.body?.text).toBe("Campaign launch-week · +31 20 555 0100");
  });

  it("leaves the body out where the sign-up gave neither campaign nor phone", () => {
    const card = cardOf(render({ notice: newOrganizationNotice, props: bare?.props }));
    expect(card.body).toBeUndefined();
  });

  /** @scenario "A card's buttons open the user and the organisation in ops" */
  it("opens the user and the organisation in ops, the organisation as primary", () => {
    const card = cardOf(render({ notice: newOrganizationNotice, props: campaign?.props }));
    expect(card.actions?.map((button) => [button.text.text, button.url, button.style])).toEqual([
      ["User in ops", "https://app.langwatch.ai/ops/users?q=user_morgan", undefined],
      [
        "Organisation in ops",
        "https://app.langwatch.ai/ops/organizations?q=organization_acme",
        "primary",
      ],
    ]);
  });
});

describe("the new-user notice", () => {
  const [invitation, sso, scim] = newUserNotice.fixtures;

  /** @scenario "A join card names the person, the organisation and the route they came by" */
  it.each([
    [invitation, "👋 Riley Chen joined Acme Robotics", "riley.chen@acme.example · via invitation"],
    [sso, "👋 Riley Chen joined Acme Robotics", "riley.chen@acme.example · via SSO (Okta)"],
    [scim, "👋 Somebody joined an organisation", "via SCIM"],
  ])("names the route in %#", (fixture, title, subtitle) => {
    const card = cardOf(render({ notice: newUserNotice, props: fixture?.props }));
    expect(card.title?.text).toBe(title);
    expect(card.subtitle?.text).toBe(subtitle);
  });

  it("opens the user and the organisation in ops", () => {
    const message = render({ notice: newUserNotice, props: invitation?.props });
    expect(buttonUrlsOf(message)).toEqual([
      "https://app.langwatch.ai/ops/users?q=user_riley",
      "https://app.langwatch.ai/ops/organizations?q=organization_acme",
    ]);
  });
});

describe("the SCIM sync summary notice", () => {
  const [large, deactivations] = scimSyncSummaryNotice.fixtures;

  /** @scenario "A SCIM summary omits zero counts and caps the names" */
  it("caps the added names at three and counts the rest", () => {
    const card = cardOf(render({ notice: scimSyncSummaryNotice, props: large?.props }));
    expect(card.title?.text).toBe("📇 SCIM updated Acme Robotics");
    expect(card.subtitle?.text).toBe("42 added · 3 updated · 2 deactivated · 1 failed");
    expect(card.body?.text).toBe("Added: Riley Chen, Morgan Ellis, Sam Okafor and 39 more");
  });

  it("omits zero counts and the names line", () => {
    const card = cardOf(render({ notice: scimSyncSummaryNotice, props: deactivations?.props }));
    expect(card.subtitle?.text).toBe("2 deactivated");
    expect(card.body).toBeUndefined();
  });
});

describe("the subscription notices", () => {
  /** @scenario "A subscription notice names the organization, the plan and the subscription" */
  it("names the prospect's organization, plan and customer", () => {
    const message = render({
      notice: subscriptionProspectiveNotice,
      props: subscriptionProspectiveNotice.fixtures[0]?.props,
    });
    expect(fieldLabelsOf(message)).toEqual(["Organization", "Plan", "Customer"]);
    expect(JSON.stringify(message.blocks)).toContain("Asked about annual billing for 40 seats.");
  });

  it("names the activated subscription, its start, seats and traces", () => {
    const message = render({
      notice: subscriptionActivatedNotice,
      props: subscriptionActivatedNotice.fixtures[0]?.props,
    });
    expect(fieldLabelsOf(message)).toEqual([
      "Subscription ID",
      "Start date",
      "Seats",
      "Traces/month",
    ]);
    expect(message.text).toContain("Seats: 12");
    expect(message.text).toContain("Traces/month: 200,000");
  });

  it("says Now for a subscription with no start date", () => {
    const message = render({
      notice: subscriptionActivatedNotice,
      props: subscriptionActivatedNotice.fixtures[1]?.props,
    });
    expect(message.text).toContain("Start date: Now");
    expect(message.text).toContain("Seats: -");
  });

  it("names the cancelled subscription and when", () => {
    const message = render({
      notice: subscriptionCancelledNotice,
      props: subscriptionCancelledNotice.fixtures[0]?.props,
    });
    expect(fieldLabelsOf(message)).toEqual(["Subscription ID", "Cancellation date"]);
  });
});

describe("the limit notices", () => {
  /** @scenario "A limit notice names the organization, its admin, its plan and the cap it hit" */
  it.each([planLimitReachedNotice, resourceLimitReachedNotice])(
    "$id names the cap as used/allowed",
    (notice) => {
      const message = render({ notice, props: notice.fixtures[0]?.props });
      expect(fieldLabelsOf(message).slice(0, 3)).toEqual(["Organization", "Admin", "Plan"]);
      expect(message.text).toMatch(/: [\d,]+\/[\d,]+/);
    },
  );

  it("says unknown where the organization has no admin on record", () => {
    const message = render({
      notice: resourceLimitReachedNotice,
      props: resourceLimitReachedNotice.fixtures[1]?.props,
    });
    expect(message.text).toContain("Admin: unknown");
  });
});

describe("the self-hosted signal notice", () => {
  /** @scenario "A self-hosted lead signal names the install and what it reports" */
  it("heads with the signal and names the company, release, users, traces and instance", () => {
    const message = render({
      notice: selfHostedSignalNotice,
      props: selfHostedSignalNotice.fixtures[0]?.props,
    });
    expect(headerOf(message)).toContain("run by a company we already know");
    expect(fieldLabelsOf(message)).toEqual([
      "Company",
      "Release",
      "Users",
      "Traces, last 28 days",
      "Instance",
    ]);
  });

  it("falls back to dashes and unknowns where the report said nothing", () => {
    const message = render({
      notice: selfHostedSignalNotice,
      props: selfHostedSignalNotice.fixtures[1]?.props,
    });
    expect(message.text).toContain("Company: Unknown");
    expect(message.text).toContain("Release: unknown");
    expect(message.text).toContain("Users: -");
  });
});

describe("the license purchase notice", () => {
  /** @scenario "A license purchase names the buyer, the plan, the seats and the amount" */
  it("formats the amount from Stripe's minor unit", () => {
    const message = render({
      notice: licensePurchaseNotice,
      props: licensePurchaseNotice.fixtures[0]?.props,
    });
    expect(fieldLabelsOf(message)).toEqual(["Buyer", "Plan", "Seats", "Amount"]);
    expect(message.text).toContain("Amount: $12,500.00");
  });
});

describe("the billing threshold failure notice", () => {
  /** @scenario "A billing threshold failure links to the subscription in Stripe" */
  it("names the subscription and the reason, and links to it in Stripe", () => {
    const message = render({
      notice: billingThresholdFailureNotice,
      props: billingThresholdFailureNotice.fixtures[0]?.props,
    });
    expect(fieldLabelsOf(message)).toEqual(["Stripe subscription", "Reason"]);
    expect(buttonUrlsOf(message)).toEqual([
      "https://dashboard.stripe.com/subscriptions/sub_1QxAcmeExample",
    ]);
    expect(JSON.stringify(message.blocks)).toContain("one renewal invoice");
  });

  it("links to Stripe's test dashboard for a test-mode subscription", () => {
    const message = render({
      notice: billingThresholdFailureNotice,
      props: billingThresholdFailureNotice.fixtures[1]?.props,
    });
    expect(buttonUrlsOf(message)).toEqual([
      "https://dashboard.stripe.com/test/subscriptions/sub_1QxAcmeExample",
    ]);
  });
});
