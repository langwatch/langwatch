import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import type { PreviewEnvelope, SharedDef } from "../../types";

/** Shape check: `something@something.something` with no whitespace anywhere.
 *  Deliverability is the mailer's job; the no-whitespace rule additionally
 *  rejects header-injection / CRLF smuggling shapes like `"a@b.com\nBcc: …"`
 *  before they reach the SES / SendGrid `to` slots. */
export const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailActionParamsSchema = z.object({
  members: z.array(z.string().regex(EMAIL_RX, "Invalid email address")),
});

export type EmailActionParams = z.infer<typeof emailActionParamsSchema>;

/** The render-time preview shape this provider's ConfigForm consumes.
 *  Mirrors the server's `EmailPreview` from `trigger-template.service`. */
export interface EmailPreview extends PreviewEnvelope {
  channel: "email";
  subject: string;
  html: string;
}

const def: SharedDef = {
  action: TriggerAction.SEND_EMAIL,
  category: "notify",
  label: "Email",
  description: "Send an email to one or more team members or external recipients.",
  actionParamsSchema: emailActionParamsSchema,
};

export default def;
