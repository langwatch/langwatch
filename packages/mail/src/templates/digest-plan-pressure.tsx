import { z } from "zod";

import {
  DigestFrame,
  Meter,
  digestCommonFields,
  formatCount,
  formatPercent,
} from "./digest-parts.tsx";
import { ActionRow, DetailTable, InlineLink, Muted } from "./email-layout.tsx";
import { defineTemplate } from "./registry.ts";

export const digestPlanPressureProps = z.object({
  ...digestCommonFields,
  organizationName: z.string().min(1),
  usagePercentage: z.number().nonnegative().describe("Share of the monthly limit used, 80 or more"),
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  unit: z.string().min(1).describe("What the plan counts, plural, e.g. traces"),
  resetsOn: z.string().min(1).describe("When the month's count starts again, e.g. Oct 1"),
  filler: z
    .object({
      label: z.string().min(1).describe("What fills the plan, e.g. Full coding-agent traces"),
      sharePercent: z.number().nonnegative(),
    })
    .optional(),
  samplingUrl: z.url().describe("Already a tracked redirect"),
  redactionUrl: z.url().describe("Already a tracked redirect"),
  upgradeUrl: z.url().describe("Already a tracked redirect"),
});

export type DigestPlanPressureProps = z.infer<typeof digestPlanPressureProps>;

const isMaxed = ({ usagePercentage }: DigestPlanPressureProps): boolean => usagePercentage >= 100;

export const digestPlanPressureSubject = (props: DigestPlanPressureProps): string =>
  isMaxed(props)
    ? `${props.organizationName} has reached its plan limit`
    : `${props.organizationName} is at ${formatPercent(props.usagePercentage)} of its plan`;

export const DigestPlanPressure = (props: DigestPlanPressureProps) => {
  const { organizationName, used, limit, unit, filler } = props;

  return (
    <DigestFrame
      preview={`${formatCount(used)} of ${formatCount(limit)} ${unit} used this month, ${props.weekLabel}`}
      heading={isMaxed(props) ? "Your plan is full" : "Your plan is filling up"}
      hero={{
        value: formatPercent(props.usagePercentage),
        caption: isMaxed(props)
          ? `of the monthly limit, so new ${unit} are being dropped`
          : `of the monthly limit used, resets ${props.resetsOn}`,
      }}
      whatsNew={props.whatsNew}
      reason={`You are an admin of ${organizationName}.`}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Meter percent={props.usagePercentage} />
      <DetailTable
        rows={[
          { label: `${unit} this month`, value: `${formatCount(used)} of ${formatCount(limit)}` },
          ...(filler
            ? [{ label: filler.label, value: `${formatPercent(filler.sharePercent)} of the total` }]
            : []),
          { label: "Resets", value: props.resetsOn },
        ]}
      />
      <ActionRow
        primary={{ href: props.samplingUrl, label: "Sample what you keep" }}
        secondary={{ href: props.upgradeUrl, label: "Upgrade your plan" }}
      />
      <Muted>
        Or keep sensitive content out of traces with{" "}
        <InlineLink href={props.redactionUrl}>redaction</InlineLink>.
      </Muted>
    </DigestFrame>
  );
};

const whatsNew = {
  title: "Sampling for coding-agent traces",
  body: "Keep one in ten routine sessions and every failed one.",
  gradient: "ember",
  linkLabel: "Read the guide",
  linkUrl: "https://app.langwatch.ai/api/digest/c/tk_7Hq2nWc9",
} as const;

const links = {
  unsubscribeUrl: "https://app.langwatch.ai/api/digest/c/tk_unsub4Zr1",
  samplingUrl: "https://app.langwatch.ai/api/digest/c/tk_sampl8Ld3",
  redactionUrl: "https://app.langwatch.ai/api/digest/c/tk_redac2Qp6",
  upgradeUrl: "https://app.langwatch.ai/api/digest/c/tk_upgra5Vm0",
} as const;

export const digestPlanPressureTemplate = defineTemplate({
  id: "digest-plan-pressure",
  title: "Weekly digest: plan pressure",
  sentWhen:
    "An organization admin's week, when the month's usage is at 80% of the plan limit or more.",
  schema: digestPlanPressureProps,
  subject: digestPlanPressureSubject,
  Component: DigestPlanPressure,
  fixtures: {
    "at 85% with a clear culprit": {
      weekLabel: "Sep 22 to 28",
      organizationName: "Acme Corp",
      usagePercentage: 85.2,
      used: 852_400,
      limit: 1_000_000,
      unit: "traces",
      resetsOn: "Oct 1",
      filler: { label: "Full coding-agent traces", sharePercent: 61 },
      whatsNew,
      ...links,
    },
    "maxed out, no card": {
      weekLabel: "Sep 22 to 28",
      organizationName: "Northwind Labs",
      usagePercentage: 100,
      used: 250_000,
      limit: 250_000,
      unit: "traces",
      resetsOn: "Oct 1",
      filler: { label: "Full coding-agent traces", sharePercent: 78 },
      ...links,
    },
    "at 82% and spread evenly": {
      weekLabel: "Sep 22 to 28",
      organizationName: "Globex",
      usagePercentage: 82,
      used: 4_100_000,
      limit: 5_000_000,
      unit: "traces",
      resetsOn: "Oct 1",
      ...links,
    },
  },
});
