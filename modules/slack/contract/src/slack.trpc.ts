/**
 * Every `slackIntegration.*` procedure, declared once (ADR-031). The wire name
 * is main's. Spec: specs/automations/slack-connections.feature.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  slackConnectionDeletedSchema,
  slackConnectionKindSchema,
  slackConnectionListSchema,
  slackConnectionScopeTypeSchema,
  slackManagedConnectionSchema,
} from "./slack.schemas.ts";

const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/";
/** Main's refusal for a webhook secret that is not a Slack incoming webhook URL. */
export const SLACK_WEBHOOK_MESSAGE = `Expected a Slack incoming webhook URL (${SLACK_WEBHOOK_PREFIX}…).`;

export function isSlackWebhookUrl(secret: string): boolean {
  return secret.startsWith(SLACK_WEBHOOK_PREFIX);
}

const nameSchema = z.string().trim().min(1).max(120);
const secretSchema = z.string().trim().min(1);

const listInputSchema = z.object({ projectId: z.string() });

const createInputSchema = z
  .object({
    projectId: z.string(),
    name: nameSchema,
    kind: slackConnectionKindSchema,
    scopeType: slackConnectionScopeTypeSchema,
    scopeId: z.string(),
    secret: secretSchema,
  })
  .refine((input) => input.kind !== "INCOMING_WEBHOOK" || isSlackWebhookUrl(input.secret), {
    message: SLACK_WEBHOOK_MESSAGE,
    path: ["secret"],
  });

const updateInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
  name: nameSchema.optional(),
  scopeType: slackConnectionScopeTypeSchema.optional(),
  scopeId: z.string().optional(),
  secret: secretSchema.optional(),
  /** Confirms narrowing a connection other projects deliver through. */
  force: z.boolean().optional(),
});

/** Main's `force` is not ported: a claimed connection is never deleted (§3). */
const deleteInputSchema = z.object({ projectId: z.string(), id: z.string() });

export const slackIntegrationTrpc = defineTrpcContract("slackIntegration")
  .query("list")
  .withInput(listInputSchema)
  .withOutput(slackConnectionListSchema)

  .mutation("create")
  .withInput(createInputSchema)
  .withOutput(slackManagedConnectionSchema)

  .mutation("update")
  .withInput(updateInputSchema)
  .withOutput(slackManagedConnectionSchema)

  .mutation("delete")
  .withInput(deleteInputSchema)
  .withOutput(slackConnectionDeletedSchema)
  .build();
