/**
 * Every `emailSuppression.*` procedure, declared once (ADR-031). Two audiences
 * on one namespace: the unsubscribe pair arrives from a mail client with no
 * session, the operator pair from the settings page. The declaration says
 * nothing about either - the server half binds the access.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  emailSuppressionAcknowledgedSchema,
  emailSuppressionRowSchema,
  unsubscribeViewSchema,
} from "./automation.ts";

/** The link's token, as the unsubscribe page reads it back. */
const resolveUnsubscribeInputSchema = z.object({ token: z.string().min(1) });

/** The link's token, and how much of the mail it turns off. */
const confirmUnsubscribeInputSchema = z.object({
  token: z.string().min(1),
  scope: z.enum(["trigger", "project"]),
});

/** The project an operator is reading the suppression list of. */
const suppressionProjectScopeSchema = z.object({ projectId: z.string() });

/** One suppression row in one project. */
const removeSuppressionInputSchema = z.object({ projectId: z.string(), id: z.string() });

export const emailSuppressionTrpc = defineTrpcContract("emailSuppression")
  .query("resolveUnsubscribeToken")
  .withInput(resolveUnsubscribeInputSchema)
  .withOutput(unsubscribeViewSchema)

  .mutation("confirmUnsubscribe")
  .withInput(confirmUnsubscribeInputSchema)
  .withOutput(emailSuppressionAcknowledgedSchema)

  .query("getAll")
  .withInput(suppressionProjectScopeSchema)
  .withOutput(emailSuppressionRowSchema.array())

  .mutation("remove")
  .withInput(removeSuppressionInputSchema)
  .withOutput(emailSuppressionAcknowledgedSchema)
  .build();
