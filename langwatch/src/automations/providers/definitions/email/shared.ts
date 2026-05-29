import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import type { SharedDef } from "../../types";

/** Basic RFC-shaped email check — same lenience as most browsers. We
 *  intentionally don't try to enforce deliverability; that is the
 *  mailer's job. */
export const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailActionParamsSchema = z.object({
  members: z.array(z.string().regex(EMAIL_RX, "Invalid email address")),
});

export type EmailActionParams = z.infer<typeof emailActionParamsSchema>;

const def: SharedDef = {
  action: TriggerAction.SEND_EMAIL,
  category: "notify",
  label: "Email",
  description: "Send an email to one or more team members or external recipients.",
  actionParamsSchema: emailActionParamsSchema,
};

export default def;
