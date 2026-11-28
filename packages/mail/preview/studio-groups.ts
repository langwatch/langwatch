/** One heading in the message list and the templates under it, in registry order. */
export interface TemplateGroup<T> {
  heading: string;
  templates: T[];
}

interface GroupRule {
  heading: string;
  ids: readonly string[];
}

const GROUP_RULES: readonly GroupRule[] = [
  {
    heading: "Account and sign-in",
    ids: [
      "sign-up-verification",
      "address-confirmation",
      "reset-password",
      "organization-mfa-requirement",
      "platform-operator-change",
    ],
  },
  {
    heading: "Organisation and team",
    ids: [
      "invite",
      "invite-re-request",
      "join-request-arrived",
      "join-request-reminder",
      "join-request-approved",
      "join-request-rejected",
      "join-request-expired",
      "domain-auto-joined",
      "seat-request",
      "idp-refused-sign-in",
      "sso-domain-proof-wavering",
      "sso-domain-proof-lapsed",
      "staff-access-notice",
    ],
  },
  {
    heading: "Billing and usage",
    ids: [
      "license",
      "connected-statement",
      "payment-recovery",
      "budget-increase-request",
      "usage-limit",
      "automation-limit",
    ],
  },
  { heading: "Alerts", ids: ["upgrade-alert", "monitor-auto-paused", "trigger-digest"] },
];

export const OTHER_HEADING = "Other";

/** Weekly digests have their own tab; trigger-digest is an automation alert, not one of them. */
export const isWeeklyDigest = (id: string): boolean => id.startsWith("digest-");

/** The templates whose name holds the query, ignoring case; an empty query keeps them all. */
export const filterTemplates = <T extends { title: string }>({
  templates,
  query,
}: {
  templates: readonly T[];
  query: string;
}): T[] => {
  const needle = query.trim().toLowerCase();
  return templates.filter((template) => template.title.toLowerCase().includes(needle));
};

const headingFor = (id: string): string =>
  GROUP_RULES.find((rule) => rule.ids.includes(id))?.heading ?? OTHER_HEADING;

/** The message list's headings in a fixed order; empty ones are left out, unknown ids go last. */
export const groupTemplates = <T extends { id: string }>({
  templates,
}: {
  templates: readonly T[];
}): TemplateGroup<T>[] =>
  [...GROUP_RULES.map((rule) => rule.heading), OTHER_HEADING]
    .map((heading) => ({
      heading,
      templates: templates.filter((template) => headingFor(template.id) === heading),
    }))
    .filter((group) => group.templates.length > 0);

/** One stop in the message list: an email and one of its variants. */
export interface ListStop {
  id: string;
  fixture: string;
}

/**
 * The stop one step from `selected` in list order, wrapping at both ends: an email's
 * variants come before the next email. An unknown or empty `selected` lands on the first.
 */
export const stepSelection = ({
  templates,
  selected,
  direction,
}: {
  templates: readonly { id: string; fixtures: readonly { name: string }[] }[];
  selected: ListStop | null;
  direction: 1 | -1;
}): ListStop | null => {
  const stops = groupTemplates({ templates }).flatMap((group) =>
    group.templates.flatMap((template) =>
      template.fixtures.map((fixture) => ({ id: template.id, fixture: fixture.name })),
    ),
  );
  if (stops.length === 0) return null;
  const current = stops.findIndex(
    (stop) => stop.id === selected?.id && stop.fixture === selected.fixture,
  );
  if (current === -1) return stops[0] ?? null;
  return stops[(current + direction + stops.length) % stops.length] ?? null;
};
