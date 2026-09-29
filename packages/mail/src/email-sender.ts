import type { EmailContent, EmailDelivery, MailSender } from "./providers/types.ts";

export const computeDefaultFrom = (mailer: EmailDelivery): string => mailer.defaultFrom();

export const sendEmail = async ({
  mailer,
  content,
}: {
  mailer: MailSender;
  content: EmailContent;
}) => {
  return mailer.send(content);
};
