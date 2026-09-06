import { createLogger } from "@langwatch/observability";
import { env } from "../../env.mjs";
import { resolveEmailProvider } from "./providers";
import type { EmailContent } from "./providers/types";

const logger = createLogger("langwatch:mailer:emailSender");

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

export const computeDefaultFrom = (): string => {
  if (env.EMAIL_DEFAULT_FROM) return env.EMAIL_DEFAULT_FROM;
  const hostname = extractHostname(env.BASE_HOST ?? "");
  if (hostname.includes("app.langwatch.ai") || hostname.includes("localhost")) {
    return "LangWatch <contact@langwatch.ai>";
  }
  return `LangWatch <mailer@${hostname}>`;
};

export const sendEmail = async (content: EmailContent) => {
  const provider = resolveEmailProvider();

  if (!provider) {
    logger.error("No email sending method available. Skipping email sending.");
    throw new Error(
      "No email sending method available. Skipping email sending.",
    );
  }

  return await provider.send({ content, defaultFrom: computeDefaultFrom() });
};
