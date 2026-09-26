import { z } from "zod";

export const deviceCodeRequestSchema = z.object({
  scopes: z.array(z.string()).optional(),
  credential_type: z.enum(["device_session", "project_api_key"]).default("device_session"),
  /**
   * `langwatch login --management`: the CLI key should also carry the
   * management permissions a CLI login key leaves out by default, limited to
   * the ones the approving person holds.
   */
  management: z.boolean().default(false),
});

export const clientInfoSchema = z
  .object({
    device_label: z.string().max(128).optional(),
    hostname: z.string().max(255).optional(),
    uname: z.string().max(64).optional(),
    platform: z.string().max(32).optional(),
  })
  .optional();

export const exchangeRequestSchema = z.object({
  device_code: z.string().min(1),
  client_info: clientInfoSchema,
});

export const refreshRequestSchema = z.object({ refresh_token: z.string().min(1) });

export const approveRequestSchema = z.object({
  user_code: z.string().min(1),
  organization_id: z.string().min(1),
  project_id: z.string().optional(),
  key_selection: z
    .object({
      bindings: z
        .array(
          z.object({
            scope_type: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
            scope_id: z.string().min(1).max(64),
          }),
        )
        .max(200),
      permissions: z.array(z.string().min(1).max(128)).max(500),
    })
    .optional(),
});

export const denyRequestSchema = z.object({ user_code: z.string().min(1) });

export const logoutRequestSchema = z.object({
  refresh_token: z.string().optional(),
  access_token: z.string().optional(),
});

export const lookupQuerySchema = z.object({ user_code: z.string().optional() });
