import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { EmailDelivery } from "../providers/types.ts";
import { EmailLayout, Muted, Paragraph } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/** Tells each member an administrator turned the organization's two-step requirement on or off. */
export const organizationMfaRequirementEmailProps = z.object({
  to: z.email(),
  organizationName: z.string().min(1),
  actorName: z.string().min(1),
  required: z.boolean(),
});

export type OrganizationMfaRequirementEmailProps = z.infer<
  typeof organizationMfaRequirementEmailProps
>;

const requirementTitle = (required: boolean): string =>
  required
    ? "Two-step verification is now required"
    : "Two-step verification is no longer required";

export const organizationMfaRequirementEmailSubject = ({
  organizationName,
  required,
}: OrganizationMfaRequirementEmailProps): string =>
  `${requirementTitle(required)} for ${organizationName}`;

export const OrganizationMfaRequirementEmail = ({
  organizationName,
  actorName,
  required,
}: OrganizationMfaRequirementEmailProps) => (
  <EmailLayout
    eyebrow="SECURITY"
    preview={`${requirementTitle(required)} for ${organizationName}`}
    heading={requirementTitle(required)}
  >
    <Paragraph>
      {`${actorName} ${required ? "turned on" : "turned off"} the two-step verification requirement for `}
      <strong>{organizationName}</strong>.
    </Paragraph>
    <Muted>
      {required
        ? "You will need to prove a second factor before opening this organization. Your other organizations and existing sessions are unchanged."
        : "You can open this organization without proving a second factor. Any two-step verification already set up on your account stays in place."}
    </Muted>
  </EmailLayout>
);

export const organizationMfaRequirementEmailTemplate = defineTemplate({
  id: "organization-mfa-requirement",
  title: "Two-step verification requirement changed",
  sentWhen:
    "An administrator turns an organization's two-step verification requirement on or off; every member is told.",
  schema: organizationMfaRequirementEmailProps,
  subject: organizationMfaRequirementEmailSubject,
  Component: OrganizationMfaRequirementEmail,
  fixtures: {
    default: {
      to: "morgan@acme.example",
      organizationName: "Acme",
      actorName: "Riley Chen",
      required: true,
    },
    "requirement turned off": {
      to: "morgan@acme.example",
      organizationName: "Acme",
      actorName: "Riley Chen",
      required: false,
    },
  },
});

export const sendOrganizationMfaRequirementEmail = async ({
  mailer,
  ...props
}: OrganizationMfaRequirementEmailProps & { mailer: EmailDelivery }) => {
  const { subject, html } = await renderMailTemplate(
    organizationMfaRequirementEmailTemplate,
    props,
  );
  await sendEmail({ mailer, content: { to: props.to, subject, html } });
};
