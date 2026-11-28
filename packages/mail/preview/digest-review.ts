import type { MailTemplate, renderMailTemplate as RenderMailTemplate } from "@langwatch/mail";

import type { DigestReviewSection, DigestReviewVersion } from "./studio-shared.ts";

/** One version of a digest under review; a B version is its own registered template. */
export interface DigestVersion {
  label: string;
  templateId: string;
}

export interface DigestReviewEntry {
  templateId: string;
  whoGetsThis: string;
  /** Props the fixtures show but the real sender never fills (digest-email.rules.ts). */
  notFilledToday: readonly string[];
  versionA: DigestVersion;
  versionB: DigestVersion | null;
  /** Set only for a registered digest the sender never picks, shown after those that send. */
  notSentBecause?: string;
}

const whatSendsToday = (templateId: string): DigestVersion => ({
  label: "Version A: what sends today",
  templateId,
});

/**
 * The digest that sends (digest-rows.rules.ts in enterprise/modules/digest/process picks its
 * rows): one email a week per person per organisation. Keep this list in step with the sender.
 */
export const DIGEST_REVIEW: readonly DigestReviewEntry[] = [
  {
    templateId: "digest-week",
    whoGetsThis:
      "Every member, once a week for each organisation: up to five rows from their own data (the plan for admins, scenario and eval moves, quiet projects, setup, their own coding agents, the busiest project's traces, then one New row). Sent only when a row besides New has something to say.",
    notFilledToday: [],
    versionA: whatSendsToday("digest-week"),
    versionB: null,
  },
];

/** The left-out props in plain words, for the review page. */
const NOT_FILLED_LABELS: Record<string, string> = {};

export const describeNotFilled = (prop: string): string => NOT_FILLED_LABELS[prop] ?? prop;

/** Templates without an organisation in their props are shown under this one. */
export const SAMPLE_ORGANIZATION = "Acme Corp";

/** A fixture's props without the ones the sender leaves out. */
export const asSentToday = ({
  props,
  notFilledToday,
}: {
  props: unknown;
  notFilledToday: readonly string[];
}): unknown => {
  if (typeof props !== "object" || props === null) return props;
  return Object.fromEntries(Object.entries(props).filter(([key]) => !notFilledToday.includes(key)));
};

/** One email per organisation, so the sender puts the organisation's name first. */
export const arrivingSubject = ({
  subject,
  props,
}: {
  subject: string;
  props: unknown;
}): string => {
  const named =
    typeof props === "object" && props !== null && "organizationName" in props
      ? props.organizationName
      : undefined;
  return `${typeof named === "string" ? named : SAMPLE_ORGANIZATION}: ${subject}`;
};

/** Every version's fixtures rendered as they would arrive, through the send path's renderer. */
export const buildDigestReview = async ({
  templates,
  render,
}: {
  templates: readonly MailTemplate[];
  render: typeof RenderMailTemplate;
}): Promise<DigestReviewSection[]> => {
  const renderVersion = async ({
    version,
    notFilledToday,
  }: {
    version: DigestVersion;
    notFilledToday: readonly string[];
  }): Promise<DigestReviewVersion> => {
    const template = templates.find((entry) => entry.id === version.templateId);
    if (!template) throw new Error(`No template is registered as "${version.templateId}".`);
    const cards = await Promise.all(
      template.fixtures.map(async (fixture) => {
        const props = asSentToday({ props: fixture.props, notFilledToday });
        const { subject, html, text } = await render(template, props);
        return {
          template: template.id,
          title: template.title,
          fixture: fixture.name,
          subject: arrivingSubject({ subject, props }),
          html,
          text,
        };
      }),
    );
    return { label: version.label, cards };
  };

  return Promise.all(
    DIGEST_REVIEW.map(async (entry) => {
      const versionA = await renderVersion({
        version: entry.versionA,
        notFilledToday: entry.notFilledToday,
      });
      return {
        templateId: entry.templateId,
        title: versionA.cards[0]?.title ?? entry.templateId,
        whoGetsThis: entry.whoGetsThis,
        notFilledToday: entry.notFilledToday.map(describeNotFilled),
        notSentBecause: entry.notSentBecause ?? null,
        versionA,
        versionB: entry.versionB
          ? await renderVersion({ version: entry.versionB, notFilledToday: entry.notFilledToday })
          : null,
      };
    }),
  );
};
