import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { MailSender } from "../email-sender.ts";
import { EmailLayout, Muted, Paragraph, PrimaryButton } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * Seat requests and refused sign-ins, to an organization's administrators and Billing members
 * (modules/organization/specs/seat-requests.feature). Decisions stay behind a signed-in session.
 */

const recipientNotice =
  "You are receiving this because you administer this organization or manage its billing.";

/** How the organization approves a seat; the copy follows it (ruling R6). */
const approvalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("seat_free") }),
  z.object({
    kind: z.literal("stripe_seats"),
    seatPrice: z.object({ amount: z.number(), currency: z.enum(["USD", "EUR"]) }).nullable(),
  }),
  z.object({ kind: z.literal("upgrade_plan") }),
  z.object({ kind: z.literal("contact_sales") }),
  z.object({ kind: z.literal("upgrade_licence") }),
]);

function formatPrice({ amount, currency }: { amount: number; currency: "USD" | "EUR" }): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
}

function approvalSentence(approval: z.infer<typeof approvalSchema>): string {
  switch (approval.kind) {
    case "seat_free":
      return "A seat is free, so you can approve them straight away.";
    case "stripe_seats":
      return approval.seatPrice
        ? `Approving adds one seat to your subscription at ${formatPrice(approval.seatPrice)} a month. Stripe charges only for the rest of this billing period.`
        : "Approving adds one seat to your subscription. Stripe charges only for the rest of this billing period.";
    case "upgrade_plan":
      return "Your plan has no seat for them. Upgrade your plan to approve them.";
    case "contact_sales":
      return "Your plan has no seat for them. Contact LangWatch to increase your plan, then approve them.";
    case "upgrade_licence":
      return "Your licence has no seat for them. Buy more seats for your licence, then approve them.";
  }
}

/** "Foo Bar (foo@acme.com)", or the address alone when no name is known. */
function personLabel({ name, email }: { name: string | null; email: string }): string {
  return name ? `${name} (${email})` : email;
}

/** The identity provider as a person reads it, or the generic phrase. */
function idpPhrase(idpName: string | null): { refusedBy: string; assignIn: string } {
  return idpName
    ? { refusedBy: `your identity provider (${idpName})`, assignIn: idpName }
    : { refusedBy: "your identity provider", assignIn: "your identity provider" };
}

/** The refused sign-in sentence, shared by the single mail and the seat request mail. */
export function idpRefusalSentence({
  person,
  idpName,
}: {
  person: string;
  idpName: string | null;
}): string {
  const { refusedBy, assignIn } = idpPhrase(idpName);
  return `${person} tried to sign in, but ${refusedBy} refused it. If they should have access, assign them to the LangWatch app in ${assignIn}.`;
}

/* ── One person is waiting for a seat. ───────────────────────────────────── */

export const seatRequestProps = z.object({
  recipientEmail: z.email(),
  organizationName: z.string().min(1),
  personName: z.string().nullable(),
  personEmail: z.string().min(1),
  /** Whether they hold Lite access meanwhile, or none. */
  heldWithoutAccess: z.boolean(),
  /** Set when the identity provider also refused their sign-in. */
  idpRefused: z.object({ idpName: z.string().nullable() }).nullable(),
  approval: approvalSchema,
  /** The Users page link, or null when the deployment has no public origin to link from. */
  requestsUrl: z.url().nullable(),
  /** Set when a Lite Member pressed Request access; `reason` is what they were trying to do. */
  askedFor: z.object({ reason: z.string().nullable() }).nullable().optional(),
});

export type SeatRequestProps = z.infer<typeof seatRequestProps>;

/** "Gus Growth is waiting for a seat", or the address when no name is known. */
const seatRequestHeading = ({ personName, personEmail, askedFor }: SeatRequestProps) =>
  askedFor
    ? `${personName ?? personEmail} asked for a full seat`
    : `${personName ?? personEmail} is waiting for a seat`;

/** Why the person is asking, as the first paragraph says it. */
function situationSentence({ props, person }: { props: SeatRequestProps; person: string }): string {
  if (props.askedFor) {
    const wanted = props.askedFor.reason ? ` to ${props.askedFor.reason}` : "";
    return `${person} is a Lite Member of ${props.organizationName} and asked for a full seat${wanted}.`;
  }
  return props.heldWithoutAccess
    ? `${person} joined ${props.organizationName}, but every seat is taken, so they have no access yet.`
    : `${person} joined ${props.organizationName} with view-only access because every full seat is taken.`;
}

export const seatRequestSubject = (props: SeatRequestProps) =>
  `${seatRequestHeading(props)} in ${props.organizationName}`;

export const SeatRequestEmail = (props: SeatRequestProps) => {
  const person = personLabel({ name: props.personName, email: props.personEmail });
  return (
    <EmailLayout
      preview={seatRequestSubject(props)}
      heading={seatRequestHeading(props)}
      footNote={recipientNotice}
    >
      <Paragraph>{situationSentence({ props, person })}</Paragraph>
      <Paragraph>{approvalSentence(props.approval)}</Paragraph>
      {props.idpRefused && (
        <Paragraph>
          {`Their sign-in was also refused by ${idpPhrase(props.idpRefused.idpName).refusedBy}. If they should have access, assign them to the LangWatch app in ${idpPhrase(props.idpRefused.idpName).assignIn}.`}
        </Paragraph>
      )}
      {props.requestsUrl && (
        <PrimaryButton href={props.requestsUrl}>Review the request</PrimaryButton>
      )}
    </EmailLayout>
  );
};

export const seatRequestTemplate = defineTemplate({
  id: "seat-request",
  title: "A person is waiting for a seat",
  sentWhen:
    "A person joins an organization over its seat limit, or a Lite Member presses Request access. Sent to its administrators and Billing members.",
  schema: seatRequestProps,
  subject: seatRequestSubject,
  Component: SeatRequestEmail,
  fixtures: {
    "held, paying per seat": {
      recipientEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      personName: "Foo Bar",
      personEmail: "foo@acme.example",
      heldWithoutAccess: true,
      idpRefused: null,
      approval: { kind: "stripe_seats", seatPrice: { amount: 29, currency: "EUR" } },
      requestsUrl: "https://app.langwatch.ai/settings/members?tab=requests",
    },
    "view-only, on a negotiated plan, refused by Okta": {
      recipientEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      personName: null,
      personEmail: "foo@acme.example",
      heldWithoutAccess: false,
      idpRefused: { idpName: "Okta" },
      approval: { kind: "contact_sales" },
      requestsUrl: "https://app.langwatch.ai/settings/members?tab=requests",
    },
    "a Lite Member pressed Request access": {
      recipientEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      personName: "Lena Lite",
      personEmail: "lena@acme.example",
      heldWithoutAccess: false,
      idpRefused: null,
      approval: { kind: "seat_free" },
      requestsUrl: "https://app.langwatch.ai/settings/directory?tab=people",
      askedFor: { reason: "run the workbench" },
    },
    "no public origin to link from": {
      recipientEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      personName: "Foo Bar",
      personEmail: "foo@acme.example",
      heldWithoutAccess: true,
      idpRefused: null,
      approval: { kind: "upgrade_plan" },
      requestsUrl: null,
    },
  },
});

export const sendSeatRequestEmail = async ({
  mailer,
  idempotencyKey,
  ...props
}: SeatRequestProps & { mailer: MailSender; idempotencyKey?: string }) => {
  const { subject, html } = await renderMailTemplate(seatRequestTemplate, props);
  await sendEmail({ mailer, content: { to: props.recipientEmail, subject, html, idempotencyKey } });
};

/* ── The identity provider refused somebody. ─────────────────────────────── */

export const idpRefusedSignInProps = z.object({
  recipientEmail: z.email(),
  organizationName: z.string().min(1),
  personName: z.string().nullable(),
  personEmail: z.string().min(1),
  idpName: z.string().nullable(),
});

export type IdpRefusedSignInProps = z.infer<typeof idpRefusedSignInProps>;

/** "Gus Growth tried to sign in to LangWatch", or the address when no name is known. */
export const idpRefusedSignInSubject = ({ personName, personEmail }: IdpRefusedSignInProps) =>
  `${personName ?? personEmail} tried to sign in to LangWatch`;

export const IdpRefusedSignInEmail = (props: IdpRefusedSignInProps) => (
  <EmailLayout
    preview={idpRefusedSignInSubject(props)}
    heading={idpRefusedSignInSubject(props)}
    footNote={recipientNotice}
  >
    <Paragraph>
      {idpRefusalSentence({
        person: personLabel({ name: props.personName, email: props.personEmail }),
        idpName: props.idpName,
      })}
    </Paragraph>
    <Muted>{`LangWatch did not refuse it, and ${props.organizationName} has no request to answer.`}</Muted>
  </EmailLayout>
);

export const idpRefusedSignInTemplate = defineTemplate({
  id: "idp-refused-sign-in",
  title: "A person tried to sign in to LangWatch",
  sentWhen:
    "The organization's identity provider refused a sign-in LangWatch could tie to an address. Sent to its administrators and Billing members.",
  schema: idpRefusedSignInProps,
  subject: idpRefusedSignInSubject,
  Component: IdpRefusedSignInEmail,
  fixtures: {
    okta: {
      recipientEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      personName: "Foo Bar",
      personEmail: "foo@acme.example",
      idpName: "Okta",
    },
    "an unnamed provider": {
      recipientEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      personName: null,
      personEmail: "foo@acme.example",
      idpName: null,
    },
  },
});

export const sendIdpRefusedSignInEmail = async ({
  mailer,
  idempotencyKey,
  ...props
}: IdpRefusedSignInProps & { mailer: MailSender; idempotencyKey?: string }) => {
  const { subject, html } = await renderMailTemplate(idpRefusedSignInTemplate, props);
  await sendEmail({ mailer, content: { to: props.recipientEmail, subject, html, idempotencyKey } });
};
/* ── The person who asked hears the answer. ──────────────────────────────── */

export const seatRequestAnsweredProps = z.object({
  recipientEmail: z.email(),
  organizationName: z.string().min(1),
  outcome: z.enum(["approved", "declined"]),
  /** Where LangWatch opens, or null when the deployment has no public origin to link from. */
  appUrl: z.url().nullable(),
});

export type SeatRequestAnsweredProps = z.infer<typeof seatRequestAnsweredProps>;

export const seatRequestAnsweredSubject = ({
  outcome,
  organizationName,
}: SeatRequestAnsweredProps) =>
  outcome === "approved"
    ? `You have a full seat in ${organizationName}`
    : `Your seat request in ${organizationName} was declined`;

export const SeatRequestAnsweredEmail = (props: SeatRequestAnsweredProps) => (
  <EmailLayout
    preview={seatRequestAnsweredSubject(props)}
    heading={seatRequestAnsweredSubject(props)}
    footNote={`You are receiving this because you asked for a full seat in ${props.organizationName}.`}
  >
    <Paragraph>
      {props.outcome === "approved"
        ? "An admin approved your request. Reload LangWatch and everything your role allows is open to you."
        : "An admin declined your request, so you keep the access you have now. If you still need more, talk to an organization admin."}
    </Paragraph>
    {props.outcome === "approved" && props.appUrl && (
      <PrimaryButton href={props.appUrl}>Open LangWatch</PrimaryButton>
    )}
  </EmailLayout>
);

export const seatRequestAnsweredTemplate = defineTemplate({
  id: "seat-request-answered",
  title: "A seat request was answered",
  sentWhen:
    "An administrator approves or declines a seat request. Sent to the person who asked, when LangWatch knows their account.",
  schema: seatRequestAnsweredProps,
  subject: seatRequestAnsweredSubject,
  Component: SeatRequestAnsweredEmail,
  fixtures: {
    approved: {
      recipientEmail: "lena@acme.example",
      organizationName: "Acme Corp",
      outcome: "approved",
      appUrl: "https://app.langwatch.ai",
    },
    declined: {
      recipientEmail: "lena@acme.example",
      organizationName: "Acme Corp",
      outcome: "declined",
      appUrl: "https://app.langwatch.ai",
    },
  },
});

export const sendSeatRequestAnsweredEmail = async ({
  mailer,
  idempotencyKey,
  ...props
}: SeatRequestAnsweredProps & { mailer: MailSender; idempotencyKey?: string }) => {
  const { subject, html } = await renderMailTemplate(seatRequestAnsweredTemplate, props);
  await sendEmail({
    mailer,
    content: {
      to: props.recipientEmail,
      subject,
      html,
      idempotencyKey,
    },
  });
};
