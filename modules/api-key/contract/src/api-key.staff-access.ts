import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The longest a staff access key may live: one hour, plus a minute for the mint itself. */
export const STAFF_ACCESS_KEY_MAX_LIFETIME_MS = 61 * 60 * 1000;

/**
 * `ApiKeyApi.mintStaffAccessKey` (ADR-202): an ownerless, restricted key in one organization,
 * holding only staff bag permissions. `support` writes as "LangWatch Support", `read` reads as
 * "LangWatch Staff Read".
 */
const mintStaffAccessKeyInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    permissions: z.array(z.string().min(1)).min(1),
    expiresAt: z.date(),
    kind: z.enum(["support", "read"]),
  })
  .strict();
export interface MintStaffAccessKeyInputSchema extends Named<
  typeof mintStaffAccessKeyInputSchemaDefinition
> {}
export const mintStaffAccessKeyInputSchema: MintStaffAccessKeyInputSchema =
  mintStaffAccessKeyInputSchemaDefinition;
export type MintStaffAccessKeyInput = z.infer<typeof mintStaffAccessKeyInputSchema>;

/** The minted key: its token, shown once, and its id, which the gate and the revoke name. */
export type StaffAccessKeyMinted = Readonly<{ token: string; apiKeyId: string }>;

const revokeStaffAccessKeyInputSchemaDefinition = z
  .object({ apiKeyId: z.string().min(1) })
  .strict();
export interface RevokeStaffAccessKeyInputSchema extends Named<
  typeof revokeStaffAccessKeyInputSchemaDefinition
> {}
export const revokeStaffAccessKeyInputSchema: RevokeStaffAccessKeyInputSchema =
  revokeStaffAccessKeyInputSchemaDefinition;
export type RevokeStaffAccessKeyInput = z.infer<typeof revokeStaffAccessKeyInputSchema>;
