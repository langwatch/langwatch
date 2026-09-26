import { z } from "zod";

/** The credential a project-door request carried, so a write authorizes as that key. */
export const gatewayRequestCredentialSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("apiKey"),
      apiKeyId: z.string().min(1),
      userId: z.string().min(1).nullable(),
      organizationId: z.string().min(1),
    })
    .readonly(),
  z.object({ kind: z.literal("legacyProjectKey") }).readonly(),
]);

export type GatewayRequestCredential = z.infer<typeof gatewayRequestCredentialSchema>;

/**
 * Any API key as the key door resolved it. A legacy project key is its project;
 * any other key reaches its organization and names the project it resolved to,
 * if any, so an organization key manages organization-owned rows.
 */
export const gatewayKeyCallerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), projectId: z.string().min(1) }).readonly(),
  z
    .object({
      kind: z.literal("apiKey"),
      apiKeyId: z.string().min(1),
      userId: z.string().min(1).nullable(),
      organizationId: z.string().min(1),
      resolvedProject: z
        .object({ id: z.string().min(1), teamId: z.string().min(1) })
        .readonly()
        .optional(),
    })
    .readonly(),
]);

export type GatewayKeyCaller = z.infer<typeof gatewayKeyCallerSchema>;
