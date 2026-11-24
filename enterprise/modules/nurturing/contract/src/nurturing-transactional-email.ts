// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One already-rendered email for Customer.io's transactional API, and what became of it. The
 * caller keeps its own mailer: nurturing only says whether Customer.io took the message.
 * @see modules/notification/specs/customer-io-transactional.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** One recipient's message; Customer.io delivers it, nothing about it is rendered there. */
const transactionalEmailSchemaDefinition = z
  .object({
    /** The trigger name of the transactional message in Customer.io. */
    transactionalMessageId: z.string().min(1),
    /** The recipient's bare address; nurturing files the delivery under the user's id when it belongs to a user. */
    identifiers: z.object({ email: z.string().min(1) }).strict(),
    to: z.string().min(1),
    from: z.string().min(1),
    subject: z.string(),
    /** The rendered HTML; it replaces whatever body the message holds in Customer.io. */
    body: z.string(),
    replyTo: z.string().min(1).optional(),
  })
  .strict();
export interface TransactionalEmailSchema extends Named<
  typeof transactionalEmailSchemaDefinition
> {}
export const transactionalEmailSchema: TransactionalEmailSchema =
  transactionalEmailSchemaDefinition;

export type TransactionalEmail = z.infer<typeof transactionalEmailSchema>;

/** Why Customer.io did not take a send: a class only, never the request or the reply body. */
export type TransactionalEmailRefusal = "status" | "timeout" | "network";

/**
 * `queued`: Customer.io took it, with its delivery id when the reply held one. `refused`: it did
 * not, and the caller sends it another way. `off`: this deployment has no Customer.io App API
 * key, so nothing was attempted.
 */
export type TransactionalEmailOutcome =
  | Readonly<{ outcome: "queued"; deliveryId?: string }>
  | Readonly<{ outcome: "refused"; reason: TransactionalEmailRefusal; status?: number }>
  | Readonly<{ outcome: "off" }>;
