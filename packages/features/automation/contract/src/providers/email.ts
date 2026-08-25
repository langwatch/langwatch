import { z } from "zod";
import type { PreviewEnvelope, SharedDef } from "../provider-types";

export const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailActionParamsSchema = z.object({
  members: z
    .array(z.string().regex(EMAIL_RX, "Invalid email address"))
    .min(1, "Add at least one recipient."),
});
export type EmailActionParams = z.infer<typeof emailActionParamsSchema>;

export interface EmailPreview extends PreviewEnvelope {
  channel: "email";
  subject: string;
  html: string;
}

const definition: SharedDef = {
  action: "SEND_EMAIL",
  category: "notify",
  label: "Email",
  description: "Send an email to one or more team members or external recipients.",
  actionParamsSchema: emailActionParamsSchema,
};

export default definition;
