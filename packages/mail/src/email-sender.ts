export type EmailAttachment = {
  filename: string;
  content: string;
  contentType: string;
};

/** One rendered message, as a template hands it to NotificationApi's sender. */
export type EmailContent = {
  /** Stable identity of one recipient's delivery, so a retry is not a second mail. */
  idempotencyKey?: string;
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  attachments?: EmailAttachment[];
};

/** All a template needs to hand over what it rendered; NotificationApi's sender answers it. */
export type MailSender = { send(content: EmailContent): Promise<unknown> };

export const sendEmail = async ({
  mailer,
  content,
}: {
  mailer: MailSender;
  content: EmailContent;
}) => {
  return mailer.send(content);
};
