import { z } from "zod";

/** A connection's id prefix (ARCHITECTURE.md §3.2); ids main minted stay accepted. */
export const SLACK_INTEGRATION_KSUID_RESOURCE = "slackintegration";

export const slackConnectionKindSchema = z.enum(["BOT", "INCOMING_WEBHOOK"]);
export type SlackConnectionKind = z.infer<typeof slackConnectionKindSchema>;

export const slackConnectionScopeTypeSchema = z.enum(["ORGANIZATION", "PROJECT"]);
export type SlackConnectionScopeType = z.infer<typeof slackConnectionScopeTypeSchema>;

/** What a client may know about a connection. The secret has no field here. */
export const slackConnectionViewSchema = z.object({
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
export type SlackConnectionView = z.infer<typeof slackConnectionViewSchema>;

/** A view with whether the caller may change it, as the settings list reads it. */
export const slackManagedConnectionSchema = z.object({
  ...slackConnectionViewSchema.shape,
  canManage: z.boolean(),
});
export type SlackManagedConnection = z.infer<typeof slackManagedConnectionSchema>;

export const slackConnectionListSchema = z.object({
  connections: slackManagedConnectionSchema.array(),
  canManageProject: z.boolean(),
  canManageOrganization: z.boolean(),
});
export type SlackConnectionList = z.infer<typeof slackConnectionListSchema>;

export const slackConnectionDeletedSchema = z.object({
  deleted: z.literal(true),
  dependentAutomations: z.number().int(),
});
export type SlackConnectionDeleted = z.infer<typeof slackConnectionDeletedSchema>;

/** The decrypted secret delivery posts with; only automation's delivery reads it. */
export const slackConnectionSecretSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BOT"), token: z.string() }),
  z.object({ kind: z.literal("INCOMING_WEBHOOK"), url: z.string() }),
]);
export type SlackConnectionSecret = z.infer<typeof slackConnectionSecretSchema>;

/** Who holds a connection in use: an automation, by id and display label. */
export const slackConnectionClaimantSchema = z.object({ id: z.string(), label: z.string() });
export type SlackConnectionClaimant = z.infer<typeof slackConnectionClaimantSchema>;

/** One `GET /api/slack-connections` item: picked field by field, so no secret rides along. */
export const slackConnectionRestResponseSchema = z.object({
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
export type SlackConnectionRestResponse = z.infer<typeof slackConnectionRestResponseSchema>;
