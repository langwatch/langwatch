import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { EmailDelivery } from "../providers/types.ts";
import { EmailLayout, Paragraph, PrimaryButton } from "./email-layout.tsx";
import { FirstSteps, firstStepsSchema } from "./onboarding/first-steps.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * The email carrying a sign-up address's confirmation link (D13, ADR-117
 * §6): the address is verified before any sign-in method is chosen, so
 * this send is the first thing sign-up does and nothing exists until it returns.
 */
export const signUpVerificationEmailProps = z.object({
  email: z.email(),
  verificationUrl: z.url(),
  /**
   * First steps shown after confirmation (if present). Defaults used (organization
   * not yet created).
   */
  firstSteps: firstStepsSchema.optional(),
});

export type SignUpVerificationEmailProps = z.infer<typeof signUpVerificationEmailProps>;

export const signUpVerificationEmailSubject = (): string =>
  "Confirm your email address for LangWatch";

export const SignUpVerificationEmail = ({
  email,
  verificationUrl,
  firstSteps,
}: SignUpVerificationEmailProps) => (
  <EmailLayout
    eyebrow="ACCOUNT"
    preview="Confirm your address and carry on"
    heading="Confirm your email address"
  >
    <Paragraph>
      Someone started creating a LangWatch account with this address (<strong>{email}</strong>).
      Confirm it below to carry on.
    </Paragraph>
    <PrimaryButton href={verificationUrl}>Confirm my email address</PrimaryButton>
    {firstSteps && <FirstSteps {...firstSteps} />}
    <Paragraph>
      This link expires in 1 hour and can be used once. If this was not you, you can ignore this
      email — the account cannot sign anybody in until this address is confirmed, and it will not be
      used for anything else.
    </Paragraph>
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
      firstSteps: {},
    },
    "without the first steps": {
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
