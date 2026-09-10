import { z } from "zod";
import { sendEmail } from "../email-sender.ts";
import type { EmailDelivery } from "../providers/types.ts";
import { EmailLayout, Paragraph, PrimaryButton } from "./email-layout.tsx";
import { FirstSteps, firstStepsSchema } from "./onboarding/first-steps.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * The email that carries a sign-up address's confirmation link (D13,
 * ADR-117 §6: sign-up verifies the address before any sign-in method is
 * chosen, so this send is the first thing sign-up does and nothing exists for
 * the address until the link comes back).
 */
export const signUpVerificationEmailProps = z.object({
  email: z.email(),
  verificationUrl: z.url(),
  /**
   * The first steps to show, when the sender wants them shown.
   *
   * Present, the mail carries what to do once they are in, so the empty
   * project on the other side of the link is not the first thing the reader
   * meets. Absent, the message is only the confirmation it always was: this
   * arrives before an account exists, so it is onboarding and never an offer.
   *
   * The organization does not exist yet at this point in sign-up, so nothing
   * here knows why they came and the block falls back to its default steps.
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
      email: nothing has been created.
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
