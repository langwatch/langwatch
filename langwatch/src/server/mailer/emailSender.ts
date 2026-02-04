import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import sgMail from "@sendgrid/mail";
import { env } from "../../env.mjs";
import { createLogger } from "../../utils/logger/server";

const logger = createLogger("langwatch:mailer:emailSender");

type EmailContent = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
};

const extractHostname = (baseHost: string): string => {
  // Try to parse as URL first
  try {
    const url = new URL(baseHost);
    return url.hostname;
  } catch {
    // Fallback: strip protocol and extract hostname manually
    const withoutProtocol = baseHost.replace(/^[a-z]+:\/\//i, "");
    const hostname = withoutProtocol.split("/")[0]?.trim() ?? "";
    return hostname !== "" ? hostname : "localhost";
  }
};

export const sendEmail = async (content: EmailContent) => {
  if (!env.SENDGRID_API_KEY && !(env.USE_AWS_SES && env.AWS_REGION)) {
    logger.error("No email sending method available. Skipping email sending.");
    throw new Error(
      "No email sending method available. Skipping email sending.",
    );
  }

  const defaultFrom =
    env.EMAIL_DEFAULT_FROM ??
    (() => {
      const hostname = extractHostname(env.BASE_HOST);
      if (
        hostname.includes("app.langwatch.ai") ||
        hostname.includes("localhost")
      ) {
        return "LangWatch <contact@langwatch.ai>";
      }
      return `LangWatch <mailer@${hostname}>`;
    })();

  if (env.USE_AWS_SES && env.AWS_REGION) {
    return await sendWithSES(content, defaultFrom);
  } else if (env.SENDGRID_API_KEY) {
    return await sendWithSendGrid(content, defaultFrom);
  }
};

const sendWithSES = async (content: EmailContent, defaultFrom: string) => {
  logger.info("Sending email using AWS SES");
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
    Source: content.from ?? defaultFrom,
  };

  try {
    const command = new SendEmailCommand(params);
    const data = await sesClient.send(command);
    logger.info({ data }, "Email sent successfully");
    return data;
  } catch (error) {
    logger.error({ error }, "Error sending email with SES");
    throw error;
  }
};

const sendWithSendGrid = async (content: EmailContent, defaultFrom: string) => {
  sgMail.setApiKey(env.SENDGRID_API_KEY ?? "");

  const msg = {
    to: content.to,
    from: content.from ?? defaultFrom,
    subject: content.subject,
    html: content.html,
  };

  try {
    return await sgMail.send(msg);
  } catch (error) {
    logger.error({ error }, "Error sending email with SendGrid");
    throw error;
  }
};
