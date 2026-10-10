import type { Named } from "@langwatch/module";
import { z } from "zod";

const deviceCodeRequestSchemaDefinition = z.object({
  scopes: z.array(z.string()).optional(),
  credential_type: z.enum(["device_session", "project_api_key"]).default("device_session"),
  /**
   * `langwatch login --management`: the CLI key should also carry the
   * management permissions a CLI login key leaves out by default, limited to
   * the ones the approving person holds.
   */
  management: z.boolean().default(false),
});
export interface DeviceCodeRequestSchema extends Named<typeof deviceCodeRequestSchemaDefinition> {}
export const deviceCodeRequestSchema: DeviceCodeRequestSchema = deviceCodeRequestSchemaDefinition;

const clientInfoSchemaDefinition = z
  .object({
    device_label: z.string().max(128).optional(),
    hostname: z.string().max(255).optional(),
    uname: z.string().max(64).optional(),
    platform: z.string().max(32).optional(),
  })
  .optional();
export interface ClientInfoSchema extends Named<typeof clientInfoSchemaDefinition> {}
export const clientInfoSchema: ClientInfoSchema = clientInfoSchemaDefinition;

const exchangeRequestSchemaDefinition = z.object({
  device_code: z.string().min(1),
  client_info: clientInfoSchema,
});
export interface ExchangeRequestSchema extends Named<typeof exchangeRequestSchemaDefinition> {}
export const exchangeRequestSchema: ExchangeRequestSchema = exchangeRequestSchemaDefinition;

/** A rotation may re-scope the session to another project the person can reach, by id or slug. */
const refreshRequestSchemaDefinition = z.object({
  refresh_token: z.string().min(1),
  project_id: z.string().min(1).optional(),
  project_slug: z.string().min(1).optional(),
});
export interface RefreshRequestSchema extends Named<typeof refreshRequestSchemaDefinition> {}
export const refreshRequestSchema: RefreshRequestSchema = refreshRequestSchemaDefinition;

const approveRequestSchemaDefinition = z.object({
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
export interface ApproveRequestSchema extends Named<typeof approveRequestSchemaDefinition> {}
export const approveRequestSchema: ApproveRequestSchema = approveRequestSchemaDefinition;

const denyRequestSchemaDefinition = z.object({ user_code: z.string().min(1) });
export interface DenyRequestSchema extends Named<typeof denyRequestSchemaDefinition> {}
export const denyRequestSchema: DenyRequestSchema = denyRequestSchemaDefinition;

const logoutRequestSchemaDefinition = z.object({
  refresh_token: z.string().optional(),
  access_token: z.string().optional(),
});
export interface LogoutRequestSchema extends Named<typeof logoutRequestSchemaDefinition> {}
export const logoutRequestSchema: LogoutRequestSchema = logoutRequestSchemaDefinition;

const lookupQuerySchemaDefinition = z.object({ user_code: z.string().optional() });
export interface LookupQuerySchema extends Named<typeof lookupQuerySchemaDefinition> {}
export const lookupQuerySchema: LookupQuerySchema = lookupQuerySchemaDefinition;

/** The approval stream the CLI waits on: its device code is the whole credential. */
const deviceApprovalQuerySchemaDefinition = z.object({ device_code: z.string().min(1) });
export interface DeviceApprovalQuerySchema extends Named<
  typeof deviceApprovalQuerySchemaDefinition
> {}
export const deviceApprovalQuerySchema: DeviceApprovalQuerySchema =
  deviceApprovalQuerySchemaDefinition;

export function cliUserTokensIndexKey(userId: string): string {
  return `lwcli:user:${userId}:tokens`;
}

export function cliAccessTokenKey(token: string): string {
  return `lwcli:access:${token}`;
}

export function cliRefreshTokenKey(token: string): string {
  return `lwcli:refresh:${token}`;
}
