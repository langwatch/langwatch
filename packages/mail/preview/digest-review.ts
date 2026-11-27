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
}

const whatSendsToday = (templateId: string): DigestVersion => ({
  label: "Version A: what sends today",
  templateId,
});

/**
 * The digests that send, in the order the sender tries them (digest-template.rules.ts in
 * enterprise/modules/digest/process): a person gets the first they qualify for, once a week
 * per organisation. Keep this list in that order when the rules change.
 */
export const DIGEST_REVIEW: readonly DigestReviewEntry[] = [
  {
    templateId: "digest-plan-pressure",
    whoGetsThis:
      "Organisation admins, when this month's usage is at 80% or more of a plan with a limit.",
    notFilledToday: ["whatsNew", "filler"],
    versionA: whatSendsToday("digest-plan-pressure"),
    versionB: null,
  },
  {
    templateId: "digest-scenarios-trend",
    whoGetsThis:
      "Members whose busiest project's scenario failure rate moved 10 points or more against the four weeks before, either way.",
    notFilledToday: ["whatsNew", "topFailing"],
    versionA: whatSendsToday("digest-scenarios-trend"),
    versionB: null,
  },
  {
    templateId: "digest-coding-agent-week",
    whoGetsThis: "Members who ran 5 or more coding-agent sessions this week.",
    notFilledToday: ["whatsNew"],
    versionA: whatSendsToday("digest-coding-agent-week"),
    versionB: null,
  },
  {
    templateId: "digest-traces-week",
    whoGetsThis: "Members whose busiest project recorded 1,000 or more traces this week.",
    notFilledToday: ["whatsNew"],
    versionA: whatSendsToday("digest-traces-week"),
    versionB: null,
  },
];

/** The left-out props in plain words, for the review page. */
const NOT_FILLED_LABELS: Record<string, string> = {
  whatsNew: "the What's new card",
  filler: "what fills the plan",
  topFailing: "the most-failing scenario",
};

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
        versionA,
        versionB: entry.versionB
          ? await renderVersion({ version: entry.versionB, notFilledToday: entry.notFilledToday })
          : null,
      };
    }),
  );
};
