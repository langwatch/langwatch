import { z } from "zod";
import { sendEmail } from "../email-sender.ts";
import type { EmailDeliveryPort } from "../providers/types.ts";
import { EmailLayout, Paragraph, PrimaryButton } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

export const resetPasswordEmailProps = z.object({
  email: z.email().describe("The account the reset was requested for"),
  resetUrl: z.url(),
});

export type ResetPasswordEmailProps = z.infer<typeof resetPasswordEmailProps>;

export const resetPasswordEmailSubject = (): string => "Reset your LangWatch password";

export const ResetPasswordEmail = ({ email, resetUrl }: ResetPasswordEmailProps) => (
  <EmailLayout eyebrow="SECURITY" preview="Choose a new password" heading="Reset your password">
    <Paragraph>
      We received a request to reset the password for your LangWatch account (
      <strong>{email}</strong>). Choose a new one below.
    </Paragraph>
    <PrimaryButton href={resetUrl}>Reset password</PrimaryButton>
    <Paragraph>
      This link expires in 1 hour. If you did not request a password reset, you can safely ignore
      this email and your password will stay the same.
    </Paragraph>
  </EmailLayout>
);

export const resetPasswordEmailTemplate = defineTemplate({
  id: "reset-password",
  title: "Reset your password",
  sentWhen: "Somebody asks to reset the password on their account.",
  schema: resetPasswordEmailProps,
  subject: resetPasswordEmailSubject,
  Component: ResetPasswordEmail,
  fixtures: {
    default: {
      email: "morgan@acme.example",
      resetUrl: "https://app.langwatch.ai/auth/reset-password?token=tok_abc123def456",
    },
  },
});

export const sendResetPasswordEmail = async ({
  mailer,
  ...props
}: ResetPasswordEmailProps & { mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(resetPasswordEmailTemplate, props);
  await sendEmail({ mailer, content: { to: props.email, subject, html } });
};
