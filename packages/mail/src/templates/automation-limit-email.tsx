import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";
import { ActionRow, DataTable, EmailLayout, InlineLink, Muted, Paragraph } from "./email-layout";
import {
  accountTeamStepSchema,
  meteredNoun,
  priceLine,
  selfServeStepFields,
  usageUnitSchema,
} from "./next-step";
import { defineTemplate, renderMailTemplate } from "./registry";

const logger = createLogger("langwatch:mailer:automationLimitEmail");

export const automationLimitKinds = ["ceiling_reached", "paused"] as const;

export type AutomationLimitKind = (typeof automationLimitKinds)[number];

export const automationLimitEmailProps = z.object({
  kind: z.enum(automationLimitKinds),
  automationName: z.string().min(1),
  projectName: z.string().min(1),
  /** Confirmed matches this automation is allowed to act on per day. */
  dailyCeiling: z.number().int().positive(),
  /** Confirmed matches it dropped today, at the moment the mail was queued. */
  skippedToday: z.number().int().nonnegative(),
  actionUrl: z.url(),
  /** What the project's organization is metered in, as its own meter reports it. */
  usageUnit: usageUnitSchema.optional(),
  /**
   * Where this organization can go for a higher ceiling, resolved for it.
   *
   * Rendered only for a ceiling that was reached. A paused automation is a
   * mistake in the customer's own condition, and selling more ceiling there
   * sells them more of the mistake, so the gate is the kind and not the data.
   *
   * An organization on enterprise or negotiated terms has a ceiling that is
   * its own, so it is never shown a tier's number. It is shown the people who
   * can change the one it has.
   */
  nextStep: z
    .discriminatedUnion("kind", [
      z.object({
        ...selfServeStepFields,
        /** Confirmed matches a day one automation may act on, on that tier. */
        dailyCeiling: z.number().int().positive(),
      }),
      accountTeamStepSchema,
    ])
    .optional(),
});

export type AutomationLimitEmailProps = z.infer<typeof automationLimitEmailProps>;

export const automationLimitEmailSubject = ({
  kind,
  automationName,
}: Pick<AutomationLimitEmailProps, "kind" | "automationName">): string =>
  kind === "paused"
    ? `Automation paused: ${automationName}`
    : `Automation reached its daily limit: ${automationName}`;

export const AutomationLimitEmail = ({
  kind,
  automationName,
  projectName,
  dailyCeiling,
  skippedToday,
  actionUrl,
  usageUnit,
  nextStep,
}: AutomationLimitEmailProps) => {
  const paused = kind === "paused";
  const noun = meteredNoun(usageUnit);
  // A paused automation is a mistake in the customer's own condition, so the
  // offer is gated on the kind rather than on whether the data arrived.
  const offer = !paused && nextStep?.kind === "self_serve" ? nextStep : undefined;
  return (
    <EmailLayout
      eyebrow="AUTOMATIONS"
      preview={
        paused ? `"${automationName}" was paused` : `"${automationName}" reached its daily limit`
      }
      heading={
        paused ? `We paused "${automationName}"` : `"${automationName}" reached its daily limit`
      }
    >
      <Paragraph>
        {paused
          ? `This automation in ${projectName} matched almost every one of your ${noun}, well past its limit of ${dailyCeiling.toLocaleString()} matches a day. We have paused it so it stops creating records you did not intend.`
          : `This automation in ${projectName} matched more ${noun} today than its limit of ${dailyCeiling.toLocaleString()} a day allows, so we stopped acting on the rest for today. It is still switched on, and it starts again tomorrow.`}
      </Paragraph>
      <DataTable
        columns={[
          { key: "ceiling", label: "Daily limit", align: "right" },
          { key: "skipped", label: "Skipped today", align: "right" },
        ]}
        rows={[
          {
            key: automationName,
            cells: {
              ceiling: dailyCeiling.toLocaleString(),
              skipped: skippedToday.toLocaleString(),
            },
          },
        ]}
      />
      <Paragraph>
        {paused
          ? `Narrow its condition so it selects the ${noun} you actually want, then switch it back on.`
          : `If this is the volume you expect, narrow the condition so it selects fewer ${noun}, or ask for a higher limit.`}
      </Paragraph>
      <ActionRow
        primary={{ href: actionUrl, label: "Open the automation" }}
        {...(offer
          ? {
              secondary: { href: offer.url, label: `Upgrade to ${offer.name}` },
              note: `Raises this automation's daily limit to ${offer.dailyCeiling.toLocaleString()} matches, from ${priceLine(offer)}.`,
            }
          : {})}
      />
      {!paused && nextStep?.kind === "account_team" && (
        <Muted>
          Your ceiling is set by your agreement with us.{" "}
          <InlineLink href={nextStep.contactUrl}>Talk to your account team</InlineLink> to raise it.
        </Muted>
      )}
    </EmailLayout>
  );
};

export const automationLimitEmailTemplate = defineTemplate({
  id: "automation-limit",
  title: "Automation daily limit",
  sentWhen: "An automation matches past its daily ceiling, or runs away and is paused.",
  schema: automationLimitEmailProps,
  subject: automationLimitEmailSubject,
  Component: AutomationLimitEmail,
  fixtures: {
    "ceiling reached": {
      kind: "ceiling_reached",
      automationName: "Escalate low satisfaction",
      projectName: "Support agent",
      dailyCeiling: 500,
      skippedToday: 1_284,
      actionUrl: "https://app.langwatch.ai/support-agent/automations/auto_7Kd2ppQ4",
      nextStep: {
        kind: "self_serve",
        name: "Accelerate",
        dailyCeiling: 5_000,
        price: 199,
        currency: "USD",
        billingPeriod: "monthly",
        url: "https://app.langwatch.ai/settings/subscription/checkout/accelerate",
      },
    },
    "ceiling reached on negotiated terms": {
      kind: "ceiling_reached",
      automationName: "Escalate low satisfaction",
      projectName: "Claims triage",
      dailyCeiling: 25_000,
      skippedToday: 3_140,
      actionUrl: "https://app.langwatch.ai/claims-triage/automations/auto_7Kd2ppQ4",
      usageUnit: "events",
      nextStep: { kind: "account_team", contactUrl: "https://langwatch.ai/contact" },
    },
    "ceiling reached, nothing higher to move to": {
      kind: "ceiling_reached",
      automationName: "Escalate low satisfaction",
      projectName: "Support agent",
      dailyCeiling: 50_000,
      skippedToday: 402,
      actionUrl: "https://app.langwatch.ai/support-agent/automations/auto_7Kd2ppQ4",
    },
    paused: {
      kind: "paused",
      automationName: "Tag every conversation",
      projectName: "Support agent",
      dailyCeiling: 500,
      skippedToday: 91_402,
      actionUrl: "https://app.langwatch.ai/support-agent/automations/auto_3Bn8xxL1",
    },
  },
});

export const renderAutomationLimitEmail = async (
  props: AutomationLimitEmailProps,
): Promise<string> => (await renderMailTemplate(automationLimitEmailTemplate, props)).html;

export const sendAutomationLimitEmail = async ({
  mailer,
  to,
  ...props
}: AutomationLimitEmailProps & { to: string[]; mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(automationLimitEmailTemplate, props);
  const results = await Promise.allSettled(
    to.map((recipient) => sendEmail({ mailer, content: { to: recipient, subject, html } })),
  );

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length === 0) return;

  // The sends are independent, so one unroutable admin address must not decide
  // that the rest of the organization hears nothing. Only a batch where nothing
  // landed is a failure worth reporting upward, because the caller answers that
  // by trying again, and trying again would mail the admins who did receive it
  // a second time.
  const kinds = [...new Set(failures.map((failure) => failureKind(failure.reason)))].sort();
  if (failures.length === to.length) {
    throw new Error(
      `Could not send the automation limit email to any of its ${to.length} ` +
        `recipients (${kinds.join(", ")})`,
    );
  }

  logger.warn(
    { failed: failures.length, recipients: to.length, kinds },
    "Some automation limit emails could not be sent",
  );
};

/**
 * A provider failure reduced to something safe to write down.
 *
 * A rejection message from a mail provider routinely quotes the envelope back,
 * as in `550 5.1.1 <someone@example.com>: recipient rejected`, so the message
 * carries the recipient's address into any log or exception that repeats it.
 * The code or SMTP status is the part that tells an operator what went wrong,
 * and it names no one.
 */
function failureKind(reason: unknown): string {
  if (typeof reason === "object" && reason !== null) {
    const { code, responseCode } = reason as {
      code?: unknown;
      responseCode?: unknown;
    };
    if (typeof code === "string" && code !== "") return code;
    if (typeof responseCode === "number") return `smtp_${responseCode}`;
  }
  return reason instanceof Error ? reason.name : "unknown";
}
