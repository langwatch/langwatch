import type { EmailContent, EmailDeliveryPort } from "./providers/types.ts";

export const computeDefaultFrom = (mailer: EmailDeliveryPort): string => mailer.defaultFrom();

export const sendEmail = async ({
  mailer,
  content,
}: {
  mailer: EmailDeliveryPort;
  content: EmailContent;
}) => {
  return await mailer.send(content);
};
