import { Section, Text } from "@react-email/components";
import { z } from "zod";
import { sendEmail } from "../email-sender.ts";
import type { EmailDeliveryPort } from "../providers/types.ts";
import {
  ActionRow,
  EmailLayout,
  InlineLink,
  Muted,
  DataTable,
  Paragraph,
  expressive,
} from "./email-layout.tsx";
import {
  accountTeamStepSchema,
  meteredNoun,
  meteredNounSingular,
  priceLine,
  selfServeStepFields,
  usageUnitSchema,
} from "./next-step.ts";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

export const usageLimitEmailProps = z.object({
  organizationName: z.string().min(1),
  usagePercentage: z.number().nonnegative(),
  usagePercentageFormatted: z.string().min(1),
  currentMonthMessagesCount: z.number().int().nonnegative(),
  maxMonthlyUsageLimit: z.number().int().positive(),
  crossedThreshold: z.number().nonnegative().describe("The threshold that triggered this send"),
  projectUsageData: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      messageCount: z.number().int().nonnegative(),
    }),
  ),
  actionUrl: z.url(),
  severity: z.string().min(1).optional().describe("How the sender graded this crossing"),
  /**
   * What this organization is metered in, as its own meter reports it.
   *
   * Absent, the message keeps the word it has always used. A sender that knows
   * the meter passes it, and the numbers in the mail then carry the noun the
   * organization is actually billed on rather than a house word for both.
   */
  usageUnit: usageUnitSchema.optional(),
  /**
   * Where this organization can go next, resolved for THIS organization.
   *
   * This is the one message where the reader has already asked the question a
   * larger plan answers. At a full crossing it is still a service message
   * about an interruption, so the line goes UNDER the fix and never in place
   * of it. An organization on enterprise or negotiated terms is never quoted a
   * list price; it is pointed at the people who hold its contract.
   */
  nextStep: z
    .discriminatedUnion("kind", [
      z.object({
        ...selfServeStepFields,
        /** The monthly allowance this plan carries, in the same unit as the meter. */
        raisesLimitTo: z.number().int().positive(),
      }),
      accountTeamStepSchema,
    ])
    .optional(),
});

export type UsageLimitEmailProps = z.infer<typeof usageLimitEmailProps>;

export const usageLimitEmailSubject = ({
  severity,
  usagePercentageFormatted,
  usageUnit,
}: UsageLimitEmailProps): string => {
  const limit = `${usagePercentageFormatted}% of your monthly ${meteredNounSingular(usageUnit)} limit`;

  return severity ? `Usage ${severity}: ${limit}` : `You have used ${limit}`;
};

/**
 * How far along the bar reads.
 *
 * Green while there is room, amber once the end is in sight, red at the point
 * where messages start being dropped. Three stops rather than five: the two
 * extra cuts the old ladder had resolved to the same colour anyway.
 */
const barColour = (usagePercentage: number): string => {
  if (usagePercentage >= 95) return "#c53030";
  if (usagePercentage >= 70) return expressive.light.detail;
  return "#2f7a55";
};

/**
 * A meter built from nested table cells.
 *
 * No flexbox, no `div` with a percentage width: Outlook's engine renders
 * neither, and a progress bar that collapses to nothing is worse than no bar.
 * Two cells in one row, sized in percent, is the shape every client draws.
 */
const UsageBar = ({ usagePercentage, filled }: { usagePercentage: number; filled: number }) => (
  <table
    style={{
      width: "100%",
      borderCollapse: "collapse",
      tableLayout: "fixed",
      height: "8px",
      margin: "10px 0 0",
    }}
  >
    <tbody>
      <tr>
        <td
          style={{
            width: `${filled}%`,
            backgroundColor: barColour(usagePercentage),
            borderRadius: "4px 0 0 4px",
            fontSize: 0,
            lineHeight: "8px",
          }}
        >
          &nbsp;
        </td>
        <td
          className="lw-code"
          style={{
            width: `${100 - filled}%`,
            backgroundColor: expressive.light.field,
            borderRadius: "0 4px 4px 0",
            fontSize: 0,
            lineHeight: "8px",
          }}
        >
          &nbsp;
        </td>
      </tr>
    </tbody>
  </table>
);

/**
 * The project to look at first, when one project is actually the answer.
 *
 * With a single project the table already says it, and with an even spread
 * naming the largest sends somebody to the wrong place, so the line waits for
 * a project carrying most of the month.
 */
const HEAVIEST_PROJECT_SHARE = 0.4;

const tryHeaviestProject = (
  projectUsageData: UsageLimitEmailProps["projectUsageData"],
  currentMonthMessagesCount: number,
): { name: string; messageCount: number } | undefined => {
  if (projectUsageData.length < 2 || currentMonthMessagesCount <= 0) return undefined;
  const heaviest = [...projectUsageData].sort((a, b) => b.messageCount - a.messageCount)[0];
  if (!heaviest || heaviest.messageCount / currentMonthMessagesCount < HEAVIEST_PROJECT_SHARE) {
    return undefined;
  }

  return heaviest;
};

/** At and past this share the message is about an interruption, not an offer. */
const FULL_CROSSING = 100;

/**
 * The two actions, in the order the crossing decides.
 *
 * Below a full crossing nothing is interrupted yet, so the plan that removes
 * the limit leads and the usage page is the other thing available. At a full
 * crossing the message is about an interruption, so the page where it is dealt
 * with leads and the plan follows it — an offer standing in front of a service
 * message is the one thing this hook must never become.
 *
 * The label names the plan, so the reader knows what pressing it buys before
 * they press it, and the note carries the two facts that decide it: the
 * allowance it gives them and what it costs. Both come from the sender.
 */
const UsageActions = ({
  actionUrl,
  step,
  noun,
  fullyCrossed,
}: {
  actionUrl: string;
  step: Extract<UsageLimitEmailProps["nextStep"], { kind: "self_serve" }>;
  noun: string;
  fullyCrossed: boolean;
}) => {
  const usage = { href: actionUrl, label: "View usage details" };
  const upgrade = { href: step.url, label: `Upgrade to ${step.name}` };

  return (
    <ActionRow
      primary={fullyCrossed ? usage : upgrade}
      secondary={fullyCrossed ? upgrade : usage}
      note={`Raises your monthly limit to ${step.raisesLimitTo.toLocaleString()} ${noun}, from ${priceLine(step)}.`}
    />
  );
};

const cell = {
  padding: "10px 0",
  fontSize: "13.5px",
  color: expressive.light.text,
} as const;

export const UsageLimitEmail = ({
  organizationName,
  usagePercentage,
  usagePercentageFormatted,
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
  crossedThreshold,
  projectUsageData,
  actionUrl,
  usageUnit,
  nextStep,
}: UsageLimitEmailProps) => {
  const heaviest = tryHeaviestProject(projectUsageData, currentMonthMessagesCount);
  const noun = meteredNoun(usageUnit);
  const accountManaged = nextStep?.kind === "account_team";

  return (
    <EmailLayout
      eyebrow="USAGE"
      preview={`${usagePercentageFormatted}% of the monthly ${meteredNounSingular(usageUnit)} limit used`}
      heading={`You have used ${usagePercentageFormatted}% of your monthly ${meteredNounSingular(usageUnit)} limit`}
      footNote={`You are receiving this because you administer ${organizationName}.`}
    >
      <Paragraph>
        {`${organizationName} has used ${usagePercentageFormatted}% of its monthly ${meteredNounSingular(usageUnit)} limit. `}
        {crossedThreshold >= 100
          ? `To carry on using LangWatch, ${accountManaged ? "the limit has to be raised" : "move to a larger plan"}.`
          : `New ${noun} will start being dropped soon, and evaluations and simulations will be blocked. ${accountManaged ? "The limit can be raised." : "A larger plan raises the limit."}`}
      </Paragraph>

      <Section style={{ margin: "24px 0" }}>
        <Text style={{ ...cell, margin: 0, fontWeight: 600 }}>
          {`${currentMonthMessagesCount.toLocaleString()} of ${maxMonthlyUsageLimit.toLocaleString()} ${noun}`}
        </Text>
        <UsageBar usagePercentage={usagePercentage} filled={Math.min(usagePercentage, 100)} />
      </Section>

      <DataTable
        columns={[
          { key: "project", label: "Project", width: "70%" },
          { key: "count", label: noun, align: "right", width: "30%" },
        ]}
        rows={[...projectUsageData]
          .sort((a, b) => b.messageCount - a.messageCount)
          .map((project) => ({
            key: project.id,
            cells: { project: project.name, count: project.messageCount.toLocaleString() },
          }))}
      />

      {nextStep?.kind === "self_serve" ? (
        <UsageActions
          actionUrl={actionUrl}
          step={nextStep}
          noun={noun}
          fullyCrossed={crossedThreshold >= FULL_CROSSING}
        />
      ) : (
        <ActionRow primary={{ href: actionUrl, label: "View usage details" }} />
      )}
      {heaviest && (
        <Muted>
          {`Most of the month is ${heaviest.name}, at ${heaviest.messageCount.toLocaleString()} ${noun}. Start there.`}
        </Muted>
      )}
      {!accountManaged && !nextStep && (
        <Muted>You can move to a larger plan from the same page.</Muted>
      )}
      {nextStep?.kind === "account_team" && (
        <Muted>
          Your limits are set by your agreement with us.{" "}
          <InlineLink href={nextStep.contactUrl}>Talk to your account team</InlineLink> to raise
          them.
        </Muted>
      )}
    </EmailLayout>
  );
};

export const usageLimitEmailTemplate = defineTemplate({
  id: "usage-limit",
  title: "Monthly message limit",
  sentWhen: "An organization crosses a share of its monthly message limit. Sent to the admins.",
  schema: usageLimitEmailProps,
  subject: usageLimitEmailSubject,
  Component: UsageLimitEmail,
  fixtures: {
    "approaching the limit": {
      organizationName: "Acme Corp",
      usagePercentage: 78.4,
      usagePercentageFormatted: "78.4",
      currentMonthMessagesCount: 784_120,
      maxMonthlyUsageLimit: 1_000_000,
      crossedThreshold: 70,
      projectUsageData: [
        { id: "project_KAXYxPR8MU", name: "Support agent", messageCount: 512_403 },
        { id: "project_9mQvT7hLzR", name: "Sales copilot", messageCount: 214_688 },
        { id: "project_3bR1eeXc04", name: "Internal tools", messageCount: 57_029 },
      ],
      actionUrl: "https://app.langwatch.ai/settings/usage",
      severity: "warning",
      nextStep: {
        kind: "self_serve",
        name: "Accelerate",
        price: 199,
        currency: "USD",
        billingPeriod: "monthly",
        url: "https://app.langwatch.ai/settings/subscription/checkout/accelerate",
        raisesLimitTo: 5_000_000,
      },
    },
    "limit reached": {
      organizationName: "Acme Corp",
      usagePercentage: 100,
      usagePercentageFormatted: "100.0",
      currentMonthMessagesCount: 1_000_000,
      maxMonthlyUsageLimit: 1_000_000,
      crossedThreshold: 100,
      projectUsageData: [
        { id: "project_KAXYxPR8MU", name: "Support agent", messageCount: 1_000_000 },
      ],
      actionUrl: "https://app.langwatch.ai/settings/usage",
      severity: "critical",
      nextStep: {
        kind: "self_serve",
        name: "Accelerate",
        price: 199,
        currency: "USD",
        billingPeriod: "monthly",
        url: "https://app.langwatch.ai/settings/subscription/checkout/accelerate",
        raisesLimitTo: 5_000_000,
      },
    },
    "an organization on its own terms": {
      organizationName: "Northwind Logistics",
      usagePercentage: 88.3,
      usagePercentageFormatted: "88.3",
      currentMonthMessagesCount: 44_150_000,
      maxMonthlyUsageLimit: 50_000_000,
      crossedThreshold: 70,
      projectUsageData: [
        { id: "project_KAXYxPR8MU", name: "Claims triage", messageCount: 31_000_000 },
        { id: "project_9mQvT7hLzR", name: "Broker copilot", messageCount: 13_150_000 },
      ],
      actionUrl: "https://app.langwatch.ai/settings/usage",
      severity: "warning",
      usageUnit: "events",
      nextStep: { kind: "account_team", contactUrl: "https://langwatch.ai/contact" },
    },
    "nothing larger to move to": {
      organizationName: "Acme Corp",
      usagePercentage: 91.2,
      usagePercentageFormatted: "91.2",
      currentMonthMessagesCount: 4_560_000,
      maxMonthlyUsageLimit: 5_000_000,
      crossedThreshold: 90,
      projectUsageData: [
        { id: "project_KAXYxPR8MU", name: "Support agent", messageCount: 2_280_000 },
        { id: "project_9mQvT7hLzR", name: "Sales copilot", messageCount: 2_280_000 },
      ],
      actionUrl: "https://app.langwatch.ai/settings/usage",
      severity: "critical",
    },
  },
});

export const sendUsageLimitEmail = async ({
  mailer,
  to,
  ...props
}: UsageLimitEmailProps & { to: string; mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(usageLimitEmailTemplate, props);
  await sendEmail({ mailer, content: { to, subject, html } });
};
