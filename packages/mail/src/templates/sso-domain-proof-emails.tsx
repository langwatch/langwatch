import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { EmailDelivery } from "../providers/types.ts";
import { DetailTable, EmailLayout, Muted, Paragraph, PrimaryButton } from "./email-layout.tsx";
import { readableDate } from "./readable-date.ts";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * The two messages a domain's proof going missing produces (ADR-123). Neither
 * carries the token's value — only a fingerprint of it is kept — both name
 * exactly what to publish, and both say plainly who is unaffected.
 */

const adminNotice = "You are receiving this because you administer this organization.";

const proofRecord = z.object({
  /** `TXT`, and whatever else a future proof method publishes. */
  recordType: z.string().min(1),
  /** The full name to publish, `_langwatch-verification.acme.example`. */
  recordName: z.string().min(1),
  /** The bare label, for providers that append the domain themselves. */
  recordLabel: z.string().min(1),
});

const recordRows = ({
  recordType,
  recordName,
  recordLabel,
}: z.infer<typeof proofRecord>): readonly { label: string; value: string }[] => [
  { label: "Record type", value: recordType },
  { label: "Name", value: recordName },
  { label: "Name (if your provider wants a label)", value: recordLabel },
];

const askForAFreshRecord =
  "If you no longer have its value, ask for a fresh record from your access settings — we only keep a fingerprint of the old one, never the value itself.";

/* ── The record has just gone missing, and there is still time. ──────────── */

export const ssoDomainProofWaveringProps = z.object({
  ...proofRecord.shape,
  adminEmail: z.email(),
  organizationName: z.string().min(1),
  domain: z.string().min(1),
  /** ISO moment the grace runs out and the domain stops admitting newcomers. */
  graceEndsAt: z.string().min(1),
  accessSettingsUrl: z.url(),
});

export type SsoDomainProofWaveringProps = z.infer<typeof ssoDomainProofWaveringProps>;

export const ssoDomainProofWaveringSubject = ({ domain }: SsoDomainProofWaveringProps): string =>
  `Action needed: we can't find the verification record for ${domain}`;

const formatDeadline = (graceEndsAt: string): string =>
  readableDate(graceEndsAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export const SsoDomainProofWaveringEmail = (props: SsoDomainProofWaveringProps) => (
  <EmailLayout
    eyebrow="DOMAIN VERIFICATION"
    preview={`We can't find the verification record for ${props.domain}`}
    heading="We can't find your domain verification record"
    footNote={adminNotice}
  >
    <Paragraph>
      {`The record that proves ${props.domain} belongs to ${props.organizationName} is no longer published, so we cannot confirm the domain is yours.`}
    </Paragraph>
    <Paragraph>
      Nothing has changed yet. Single sign-on works exactly as before and everyone can still sign
      in.
    </Paragraph>
    <DetailTable rows={recordRows(props)} />
    <Paragraph>
      {`Publish the record again and we will pick it up automatically. ${askForAFreshRecord}`}
    </Paragraph>
    <Paragraph>
      {`If it is still missing on ${formatDeadline(props.graceEndsAt)}, ${props.domain} will stop letting new people join automatically.`}
    </Paragraph>
    <PrimaryButton href={props.accessSettingsUrl}>Open access settings</PrimaryButton>
    <Muted>People already in your organization are not affected at any point.</Muted>
  </EmailLayout>
);

export const ssoDomainProofWaveringTemplate = defineTemplate({
  id: "sso-domain-proof-wavering",
  title: "We can't find your domain verification record",
  sentWhen:
    "A verified domain's published record is first found missing. Sent once, to every admin.",
  schema: ssoDomainProofWaveringProps,
  subject: ssoDomainProofWaveringSubject,
  Component: SsoDomainProofWaveringEmail,
  fixtures: {
    default: {
      adminEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      domain: "acme.example",
      recordType: "TXT",
      recordName: "_langwatch-verification.acme.example",
      recordLabel: "_langwatch-verification",
      graceEndsAt: "2026-10-01T09:00:00.000Z",
      accessSettingsUrl: "https://app.langwatch.ai/settings/access",
    },
  },
});

export const sendSsoDomainProofWaveringEmail = async ({
  mailer,
  ...props
}: SsoDomainProofWaveringProps & { mailer: EmailDelivery }) => {
  const { subject, html } = await renderMailTemplate(ssoDomainProofWaveringTemplate, props);
  await sendEmail({ mailer, content: { to: props.adminEmail, subject, html } });
};

/* ── The grace ran out: what stopped, and what did not. ──────────────────── */

export const ssoDomainProofLapsedProps = z.object({
  ...proofRecord.shape,
  adminEmail: z.email(),
  organizationName: z.string().min(1),
  domain: z.string().min(1),
  accessSettingsUrl: z.url(),
});

export type SsoDomainProofLapsedProps = z.infer<typeof ssoDomainProofLapsedProps>;

export const ssoDomainProofLapsedSubject = ({
  domain,
  organizationName,
}: SsoDomainProofLapsedProps): string => `${domain} is no longer verified for ${organizationName}`;

export const SsoDomainProofLapsedEmail = (props: SsoDomainProofLapsedProps) => (
  <EmailLayout
    eyebrow="DOMAIN VERIFICATION"
    preview={`${props.domain} is no longer verified`}
    heading="Your domain is no longer verified"
    footNote={adminNotice}
  >
    <Paragraph>
      {`The record that proves ${props.domain} belongs to ${props.organizationName} has been missing since the grace period began, so we have stopped treating the domain as proof that somebody works with you.`}
    </Paragraph>
    <Paragraph>
      <strong>Everyone already in your organization can still sign in.</strong>
      {` Single sign-on is untouched. What stopped is new people: somebody signing in for the first time with a ${props.domain} address will no longer get an account automatically, and nobody joins your organization by that domain alone. You can still invite anybody, and requests to join still reach your administrators.`}
    </Paragraph>
    <DetailTable rows={recordRows(props)} />
    <Paragraph>
      {`Publish the record again and everything goes back to normal on its own — there is nothing to re-apply for and nothing to redo. ${askForAFreshRecord}`}
    </Paragraph>
    <PrimaryButton href={props.accessSettingsUrl}>Open access settings</PrimaryButton>
  </EmailLayout>
);

export const ssoDomainProofLapsedTemplate = defineTemplate({
  id: "sso-domain-proof-lapsed",
  title: "Your domain is no longer verified",
  sentWhen:
    "A verified domain's record is still missing when the grace runs out. Sent to every admin.",
  schema: ssoDomainProofLapsedProps,
  subject: ssoDomainProofLapsedSubject,
  Component: SsoDomainProofLapsedEmail,
  fixtures: {
    default: {
      adminEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      domain: "acme.example",
      recordType: "TXT",
      recordName: "_langwatch-verification.acme.example",
      recordLabel: "_langwatch-verification",
      accessSettingsUrl: "https://app.langwatch.ai/settings/access",
    },
  },
});

export const sendSsoDomainProofLapsedEmail = async ({
  mailer,
  ...props
}: SsoDomainProofLapsedProps & { mailer: EmailDelivery }) => {
  const { subject, html } = await renderMailTemplate(ssoDomainProofLapsedTemplate, props);
  await sendEmail({ mailer, content: { to: props.adminEmail, subject, html } });
};
