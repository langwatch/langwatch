import sgMail from "@sendgrid/mail";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { env } from "../../env.mjs";

type EmailContent = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
};

const DEFAULT_FROM =
  env.EMAIL_DEFAULT_FROM ??
  (env.BASE_HOST.includes("app.langwatch.ai")
    ? "LangWatch <contact@langwatch.ai>"
    : env.BASE_HOST.includes("localhost")
    ? "LangWatch <mailer@localhost>"
    : `LangWatch <mailer@${env.BASE_HOST.split("://")[1].split("/")[0]}>`);

export const sendEmail = async (content: EmailContent) => {
  if (
    !env.SENDGRID_API_KEY &&
    !(env.USE_AWS_SES && env.AWS_REGION) &&
    !env.GMAIL_CREDENTIALS
  ) {
    throw new Error(
      "No email sending method available. Skipping email sending."
    );
  }

  if (env.USE_AWS_SES && env.AWS_REGION) {
    return await sendWithSES(content);
  } else if (env.SENDGRID_API_KEY) {
    return await sendWithSendGrid(content);
  }
};

const sendWithSES = async (content: EmailContent) => {
  console.log("Sending email using AWS SES");
  const sesClient = new SESClient({ region: env.AWS_REGION });

  const params = {
    Destination: {
      ToAddresses: Array.isArray(content.to) ? content.to : [content.to],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: content.html,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: content.subject,
      },
    },
    Source: content.from ?? env.ONPREM_EMAIL ?? DEFAULT_FROM,
  };

  try {
    const command = new SendEmailCommand(params);
    const data = await sesClient.send(command);
    console.log("Email sent successfully:", data);
    return data;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

const sendWithSendGrid = async (content: EmailContent) => {
  sgMail.setApiKey(env.SENDGRID_API_KEY ?? "");

  const msg = {
    to: content.to,
    from: content.from ?? DEFAULT_FROM,
    subject: content.subject,
    html: content.html,
  };

  try {
    return await sgMail.send(msg);
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};
