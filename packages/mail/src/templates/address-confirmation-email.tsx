import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { EmailDelivery } from "../providers/types.ts";
import { EmailLayout, Paragraph, PrimaryButton } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * Confirms an address somebody added to an account they are already signed in to (D01). Not the
 * sign-up copy: that says an account is being created, which is untrue here and alarming to a
 * reader whose address was just added to an account they may not know about.
 */
export const addressConfirmationEmailProps = z.object({
  email: z.email(),
  verificationUrl: z.url(),
});

export type AddressConfirmationEmailProps = z.infer<typeof addressConfirmationEmailProps>;

export const addressConfirmationEmailSubject = (): string =>
  "Confirm this email address for LangWatch";

export const AddressConfirmationEmail = ({
  email,
  verificationUrl,
}: AddressConfirmationEmailProps) => (
  <EmailLayout
    eyebrow="ACCOUNT"
    preview="Confirm this address to sign in with it"
    heading="Confirm this email address"
  >
    <Paragraph>
      This address (<strong>{email}</strong>) was added to a LangWatch account as a way to sign in.
      Confirm it to finish:
    </Paragraph>
    <PrimaryButton href={verificationUrl}>Confirm this address</PrimaryButton>
    <Paragraph>
      Open the link in the same browser you added the address from — that is what finishes it, and
      it is why a forwarded link confirms nothing.
    </Paragraph>
    <Paragraph>
      The link expires in 15 minutes and can be used once. If this was not you, ignore this email:
      the address cannot sign anybody in until it is confirmed.
    </Paragraph>
  </EmailLayout>
);

export const addressConfirmationEmailTemplate = defineTemplate({
  id: "address-confirmation",
  title: "Confirm this email address",
  sentWhen:
    "Somebody adds another email address to their own account from their security settings.",
  schema: addressConfirmationEmailProps,
  subject: addressConfirmationEmailSubject,
  Component: AddressConfirmationEmail,
  fixtures: {
    default: {
      email: "morgan@acme.example",
      verificationUrl: "https://app.langwatch.ai/settings/security?confirm=idf_71c0aa93f5",
    },
  },
});

export const sendAddressConfirmationEmail = async ({
  mailer,
  ...props
}: AddressConfirmationEmailProps & { mailer: EmailDelivery }) => {
  const { subject, html } = await renderMailTemplate(addressConfirmationEmailTemplate, props);
  await sendEmail({ mailer, content: { to: props.email, subject, html } });
};
