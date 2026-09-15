import type { EmailContent, EmailDelivery } from "./providers/types.ts";

export const computeDefaultFrom = (mailer: EmailDelivery): string => mailer.defaultFrom();

export const sendEmail = async ({
  mailer,
  content,
}: {
  mailer: EmailDelivery;
  content: EmailContent;
}) => {
  return await mailer.send(content);
};
