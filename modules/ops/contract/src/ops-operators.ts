import type { Named } from "@langwatch/module";
/**
 * The Operators page's wire: who holds the platform-operator grant, and the
 * grant and revoke it offers. ARCHITECTURE.md, "Platform operators are a grant".
 */
import { Temporal } from "@langwatch/time";
import { z } from "zod";

/** One live holder, named for the page. */
const opsPlatformOperatorSchemaDefinition = z
  .object({
    grantId: z.string().min(1),
    userId: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    grantedAt: z.instanceof(Temporal.Instant),
  })
  .strict();
export interface OpsPlatformOperatorSchema extends Named<
  typeof opsPlatformOperatorSchemaDefinition
> {}
export const opsPlatformOperatorSchema: OpsPlatformOperatorSchema =
  opsPlatformOperatorSchemaDefinition;
export type OpsPlatformOperator = z.infer<typeof opsPlatformOperatorSchema>;

const opsPlatformOperatorListSchemaDefinition = z.array(opsPlatformOperatorSchema);
export interface OpsPlatformOperatorListSchema extends Named<
  typeof opsPlatformOperatorListSchemaDefinition
> {}
export const opsPlatformOperatorListSchema: OpsPlatformOperatorListSchema =
  opsPlatformOperatorListSchemaDefinition;

/** Existing accounts only: the address is looked up, never invited. */
const opsGrantPlatformOperatorInputSchemaDefinition = z
  .object({ email: z.string().trim().min(1).max(320) })
  .strict();
export interface OpsGrantPlatformOperatorInputSchema extends Named<
  typeof opsGrantPlatformOperatorInputSchemaDefinition
> {}
export const opsGrantPlatformOperatorInputSchema: OpsGrantPlatformOperatorInputSchema =
  opsGrantPlatformOperatorInputSchemaDefinition;
export type OpsGrantPlatformOperatorInput = z.infer<typeof opsGrantPlatformOperatorInputSchema>;

const opsRevokePlatformOperatorInputSchemaDefinition = z
  .object({ grantId: z.string().min(1) })
  .strict();
export interface OpsRevokePlatformOperatorInputSchema extends Named<
  typeof opsRevokePlatformOperatorInputSchemaDefinition
> {}
export const opsRevokePlatformOperatorInputSchema: OpsRevokePlatformOperatorInputSchema =
  opsRevokePlatformOperatorInputSchemaDefinition;
export type OpsRevokePlatformOperatorInput = z.infer<typeof opsRevokePlatformOperatorInputSchema>;
