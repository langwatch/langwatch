import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { EmailDelivery } from "../providers/types.ts";
import { ActionRow, EmailLayout, Paragraph } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * The email carrying a sign-up address's confirmation link (D13, ADR-117
 * §6): the address is verified before any sign-in method is chosen, so
 * this send is the first thing sign-up does and nothing exists until it returns.
 */
export const signUpVerificationEmailProps = z.object({
  email: z.email(),
  verificationUrl: z.url(),
});

export type SignUpVerificationEmailProps = z.infer<typeof signUpVerificationEmailProps>;

export const signUpVerificationEmailSubject = (): string =>
  "Confirm your email address for LangWatch";

/** A security message does one job: no onboarding rides along with it. */
export const SignUpVerificationEmail = ({
  email,
  verificationUrl,
}: SignUpVerificationEmailProps) => (
  <EmailLayout
    preview="Confirm your address to finish signing up"
    heading="Confirm your email address"
  >
    <Paragraph>
      Someone started creating a LangWatch account with <strong>{email}</strong>. Confirm the
      address to finish signing up.
    </Paragraph>
    <ActionRow
      primary={{ href: verificationUrl, label: "Confirm my email address" }}
      note="This link expires in 1 hour and can be used once. If this was not you, you can ignore this email: nobody can sign in to the account until the address is confirmed, and it is not used for anything else."
    />
  </EmailLayout>
);

export const signUpVerificationEmailTemplate = defineTemplate({
  id: "sign-up-verification",
  title: "Confirm your email address",
  sentWhen: "Somebody starts creating an account, before any sign-in method is chosen.",
  schema: signUpVerificationEmailProps,
  subject: signUpVerificationEmailSubject,
  Component: SignUpVerificationEmail,
  fixtures: {
    default: {
      email: "morgan@acme.example",
      verificationUrl: "https://app.langwatch.ai/auth/verify/ver_71c0aa93f5",
    },
  },
});

export const sendSignUpVerificationEmail = async ({
  mailer,
  ...props
}: SignUpVerificationEmailProps & { mailer: EmailDelivery }) => {
  const { subject, html } = await renderMailTemplate(signUpVerificationEmailTemplate, props);
  await sendEmail({ mailer, content: { to: props.email, subject, html } });
};
