import type { Named } from "@langwatch/module";
import { z } from "zod";

/** A connection's id prefix (ARCHITECTURE.md §3.2); ids main minted stay accepted. */
export const SLACK_INTEGRATION_KSUID_RESOURCE = "slackintegration";

export const slackConnectionKindSchema = z.enum(["BOT", "INCOMING_WEBHOOK"]);
export type SlackConnectionKind = z.infer<typeof slackConnectionKindSchema>;

export const slackConnectionScopeTypeSchema = z.enum(["ORGANIZATION", "PROJECT"]);
export type SlackConnectionScopeType = z.infer<typeof slackConnectionScopeTypeSchema>;

/** What a client may know about a connection. The secret has no field here. */
const slackConnectionViewSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  kind: slackConnectionKindSchema,
  scopeType: slackConnectionScopeTypeSchema,
  scopeId: z.string(),
  scopeName: z.string(),
  secretHint: z.string(),
  slackTeamId: z.string().nullable(),
  slackTeamName: z.string().nullable(),
  dependentAutomations: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export interface SlackConnectionViewSchema extends Named<
  typeof slackConnectionViewSchemaDefinition
> {}
export const slackConnectionViewSchema: SlackConnectionViewSchema =
  slackConnectionViewSchemaDefinition;
export type SlackConnectionView = z.infer<typeof slackConnectionViewSchema>;

/** A view with whether the caller may change it, as the settings list reads it. */
const slackManagedConnectionSchemaDefinition = z.object({
  ...slackConnectionViewSchema.shape,
  canManage: z.boolean(),
});
export interface SlackManagedConnectionSchema extends Named<
  typeof slackManagedConnectionSchemaDefinition
> {}
export const slackManagedConnectionSchema: SlackManagedConnectionSchema =
  slackManagedConnectionSchemaDefinition;
export type SlackManagedConnection = z.infer<typeof slackManagedConnectionSchema>;

const slackConnectionListSchemaDefinition = z.object({
  connections: slackManagedConnectionSchema.array(),
  canManageProject: z.boolean(),
  canManageOrganization: z.boolean(),
});
export interface SlackConnectionListSchema extends Named<
  typeof slackConnectionListSchemaDefinition
> {}
export const slackConnectionListSchema: SlackConnectionListSchema =
  slackConnectionListSchemaDefinition;
export type SlackConnectionList = z.infer<typeof slackConnectionListSchema>;

const slackConnectionDeletedSchemaDefinition = z.object({
  deleted: z.literal(true),
  dependentAutomations: z.number().int(),
});
export interface SlackConnectionDeletedSchema extends Named<
  typeof slackConnectionDeletedSchemaDefinition
> {}
export const slackConnectionDeletedSchema: SlackConnectionDeletedSchema =
  slackConnectionDeletedSchemaDefinition;
export type SlackConnectionDeleted = z.infer<typeof slackConnectionDeletedSchema>;

/** The decrypted secret delivery posts with; only automation's delivery reads it. */
const slackConnectionSecretSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BOT"), token: z.string() }),
  z.object({ kind: z.literal("INCOMING_WEBHOOK"), url: z.string() }),
]);
export interface SlackConnectionSecretSchema extends Named<
  typeof slackConnectionSecretSchemaDefinition
> {}
export const slackConnectionSecretSchema: SlackConnectionSecretSchema =
  slackConnectionSecretSchemaDefinition;
export type SlackConnectionSecret = z.infer<typeof slackConnectionSecretSchema>;

/** Who holds a connection in use: an automation, by id and display label. */
const slackConnectionClaimantSchemaDefinition = z.object({ id: z.string(), label: z.string() });
export interface SlackConnectionClaimantSchema extends Named<
  typeof slackConnectionClaimantSchemaDefinition
> {}
export const slackConnectionClaimantSchema: SlackConnectionClaimantSchema =
  slackConnectionClaimantSchemaDefinition;
export type SlackConnectionClaimant = z.infer<typeof slackConnectionClaimantSchema>;

/** One claim on a connection: who holds it, from which project. */
const slackConnectionClaimSchemaDefinition = z.object({
  connectionId: z.string(),
  projectId: z.string(),
  claimant: slackConnectionClaimantSchema,
});
export interface SlackConnectionClaimSchema extends Named<
  typeof slackConnectionClaimSchemaDefinition
> {}
export const slackConnectionClaimSchema: SlackConnectionClaimSchema =
  slackConnectionClaimSchemaDefinition;
export type SlackConnectionClaim = z.infer<typeof slackConnectionClaimSchema>;

/** One page of every claim, by claim id; `next` resumes after it and is null on the last page. */
const slackConnectionClaimPageSchemaDefinition = z.object({
  claims: z.array(slackConnectionClaimSchema),
  next: z.string().nullable(),
});
export interface SlackConnectionClaimPageSchema extends Named<
  typeof slackConnectionClaimPageSchemaDefinition
> {}
export const slackConnectionClaimPageSchema: SlackConnectionClaimPageSchema =
  slackConnectionClaimPageSchemaDefinition;
export type SlackConnectionClaimPage = z.infer<typeof slackConnectionClaimPageSchema>;

/** One `GET /api/slack-connections` item: picked field by field, so no secret rides along. */
const slackConnectionRestResponseSchemaDefinition = z.object({
  id: z
    .string()
    .describe("What an automation's `slackIntegrationId` names to post through this connection."),
  name: z.string(),
  kind: z
    .enum(["bot", "webhook"])
    .describe(
      "`bot` posts as the LangWatch Slack app and needs a `slackChannelId` on the automation; `webhook` posts to its incoming webhook's channel.",
    ),
  scopeType: slackConnectionScopeTypeSchema,
  scopeId: z.string(),
  scopeName: z.string(),
  slackTeamName: z.string().nullable().describe("The Slack workspace a bot connection posts into."),
  createdAt: z.string(),
});
export interface SlackConnectionRestResponseSchema extends Named<
  typeof slackConnectionRestResponseSchemaDefinition
> {}
export const slackConnectionRestResponseSchema: SlackConnectionRestResponseSchema =
  slackConnectionRestResponseSchemaDefinition;
export type SlackConnectionRestResponse = z.infer<typeof slackConnectionRestResponseSchema>;

/** The last four characters, the only part of a secret a client ever sees. */
export function slackSecretHint({ secret }: { secret: string }): string {
  return secret.trim().slice(-4);
}

/** `Slack bot ••••abcd` / `Slack webhook ••••abcd`: a connection's default name. */
export function defaultSlackConnectionName({
  kind,
  secret,
}: {
  kind: SlackConnectionKind;
  secret: string;
}): string {
  const noun = kind === "BOT" ? "bot" : "webhook";
  return `Slack ${noun} ••••${slackSecretHint({ secret })}`;
}
