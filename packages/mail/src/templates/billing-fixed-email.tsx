import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { MailSender } from "../email-sender.ts";
import { ActionRow, EmailLayout, Muted, Paragraph } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * The one email to the admin whose seat change billing refused while the organization held two
 * live subscriptions, once ops or billing itself sorted them out
 * (specs/licensing/proration-preview.feature).
 */
export const billingFixedEmailProps = z.object({
  organizationName: z.string().min(1),
  tried: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("role_change"),
      memberName: z.string().min(1),
      /** The role as the members page names it, such as "Admin". */
      role: z.string().min(1),
    }),
    z.object({ kind: z.literal("seat_purchase"), seats: z.number().int().positive() }),
  ]),
  /** "earlier today", or "on 25 November 2026" when the refusal was on an earlier day. */
  triedWhen: z.string().min(1),
  /** The seats the change still needs, priced now. */
  seats: z.number().int().positive(),
  /** Charged today for the added seats, already formatted in its currency. */
  dueToday: z.string().min(1),
  /** The recurring total after the change, already formatted. */
  recurringTotal: z.string().min(1),
  interval: z.enum(["month", "year"]),
  /** The next renewal, as a reader's date. */
  renewsOn: z.string().min(1),
  actionUrl: z.url(),
});

export type BillingFixedEmailProps = z.infer<typeof billingFixedEmailProps>;

export const billingFixedEmailSubject = ({ organizationName }: BillingFixedEmailProps): string =>
  `${organizationName}'s billing is fixed`;

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
const seatsOf = (count: number) => (count === 1 ? "1 more full seat" : `${count} more full seats`);

const triedLine = ({ tried, triedWhen }: BillingFixedEmailProps): string =>
  tried.kind === "role_change"
    ? `You tried to make ${tried.memberName} ${article(tried.role)} ${tried.role} ${triedWhen}.`
    : `You tried to add ${tried.seats === 1 ? "a seat" : `${tried.seats} seats`} ${triedWhen}.`;

/** The whole email: what was tried, what finishing it costs now, and the way back. */
export const BillingFixedEmail = (props: BillingFixedEmailProps) => (
  <EmailLayout
    preview={billingFixedEmailSubject(props)}
    heading={billingFixedEmailSubject(props)}
    footNote={`You are receiving this because you manage billing for ${props.organizationName}.`}
  >
    <Paragraph>{triedLine(props)}</Paragraph>
    <Paragraph>
      {`Billing is working again, so you can finish it now: ${seatsOf(props.seats)}, ${props.dueToday} today, then ${props.recurringTotal} a ${props.interval} from ${props.renewsOn}.`}
    </Paragraph>
    <ActionRow primary={{ href: props.actionUrl, label: "Open members" }} />
    <Muted>Nothing was charged while it was blocked.</Muted>
  </EmailLayout>
);

export const billingFixedEmailTemplate = defineTemplate({
  id: "billing-fixed",
  title: "Billing fixed after a blocked seat change",
  sentWhen:
    "Once, after a seat change an admin tried was refused because the organization held two live subscriptions, when that is sorted out. Sent to that admin only.",
  schema: billingFixedEmailProps,
  subject: billingFixedEmailSubject,
  Component: BillingFixedEmail,
  fixtures: {
    "role change": {
      organizationName: "ACME",
      tried: { kind: "role_change", memberName: "Jane Doe", role: "Admin" },
      triedWhen: "earlier today",
      seats: 1,
      dueToday: "€19.33",
      recurringTotal: "€145",
      interval: "month",
      renewsOn: "1 December 2026",
      actionUrl: "https://app.langwatch.ai/settings/members",
    },
    "seat purchase": {
      organizationName: "ACME",
      tried: { kind: "seat_purchase", seats: 2 },
      triedWhen: "on 25 November 2026",
      seats: 2,
      dueToday: "€38.67",
      recurringTotal: "€174",
      interval: "month",
      renewsOn: "1 December 2026",
      actionUrl: "https://app.langwatch.ai/settings/members",
    },
  },
});

/** Renders the billing-fixed email and sends it to one address. */
export const sendBillingFixedEmail = async ({
  mailer,
  to,
  ...props
}: BillingFixedEmailProps & { to: string; mailer: MailSender }) => {
  const { subject, html } = await renderMailTemplate(billingFixedEmailTemplate, props);
  await sendEmail({
    mailer,
    content: { to, subject, html },
  });
};
