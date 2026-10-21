import { ledgerActorSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { authzPrincipalRefSchema } from "./authz.ts";

/** Whose permissions bound a braid is the session's, so a procedure's input never names it. */
const sessionShape = { actor: ledgerActorSchema, caller: authzPrincipalRefSchema };

/** A braid's terms (ADR-183 §1): the condition text, which spans by time, and when access ends. */
const braidTermsShape = {
  /** The OTTL-subset condition as written; absent or blank braids every owner span. */
  where: z.string().optional(),
  /** The earliest span shown, epoch milliseconds; may fall before the day the braid is made. */
  fromMs: z.number().int().nonnegative(),
  /** When the reader stops seeing the spans; absent never ends. */
  expiresAtMs: z.number().int().positive().optional(),
};

const authzCreateBraidInputSchemaDefinition = z
  .object({
    /** The owner, whose spans the reader sees. */
    projectId: z.string().min(1),
    readerProjectId: z.string().min(1),
    ...braidTermsShape,
    ...sessionShape,
  })
  .strict();
export interface AuthzCreateBraidInputSchema extends Named<
  typeof authzCreateBraidInputSchemaDefinition
> {}
export const authzCreateBraidInputSchema: AuthzCreateBraidInputSchema =
  authzCreateBraidInputSchemaDefinition;
export type AuthzCreateBraidInput = z.infer<typeof authzCreateBraidInputSchema>;

const authzChangeBraidInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    readerProjectId: z.string().min(1),
    /** The braid being changed; refused with `braid_changed` once it is no longer live. */
    braidId: z.string().min(1),
    ...braidTermsShape,
    ...sessionShape,
  })
  .strict();
export interface AuthzChangeBraidInputSchema extends Named<
  typeof authzChangeBraidInputSchemaDefinition
> {}
export const authzChangeBraidInputSchema: AuthzChangeBraidInputSchema =
  authzChangeBraidInputSchemaDefinition;
export type AuthzChangeBraidInput = z.infer<typeof authzChangeBraidInputSchema>;

const authzRemoveBraidInputSchemaDefinition = z
  .object({
    /** Either side of the braid: its owner or its reader. */
    projectId: z.string().min(1),
    braidId: z.string().min(1),
    ...sessionShape,
  })
  .strict();
export interface AuthzRemoveBraidInputSchema extends Named<
  typeof authzRemoveBraidInputSchemaDefinition
> {}
export const authzRemoveBraidInputSchema: AuthzRemoveBraidInputSchema =
  authzRemoveBraidInputSchemaDefinition;
export type AuthzRemoveBraidInput = z.infer<typeof authzRemoveBraidInputSchema>;

const authzListBraidsInputSchemaDefinition = z.object({ projectId: z.string().min(1) }).strict();
export interface AuthzListBraidsInputSchema extends Named<
  typeof authzListBraidsInputSchemaDefinition
> {}
export const authzListBraidsInputSchema: AuthzListBraidsInputSchema =
  authzListBraidsInputSchemaDefinition;
export type AuthzListBraidsInput = z.infer<typeof authzListBraidsInputSchema>;

/** One live braid as both projects' settings show it. */
const authzBraidSchemaDefinition = z
  .object({
    braidId: z.string().min(1),
    ownerProjectId: z.string().min(1),
    readerProjectId: z.string().min(1),
    where: z.string().nullable(),
    fromMs: z.number().int(),
    expiresAtMs: z.number().int().nullable(),
    createdByUserId: z.string().nullable(),
    createdAtMs: z.number().int(),
  })
  .strict();
export interface AuthzBraidSchema extends Named<typeof authzBraidSchemaDefinition> {}
export const authzBraidSchema: AuthzBraidSchema = authzBraidSchemaDefinition;
export type AuthzBraid = z.infer<typeof authzBraidSchema>;

/** A project's braids: out of it into other projects, and into it from other projects. */
const authzProjectBraidsSchemaDefinition = z
  .object({
    intoOtherProjects: z.array(authzBraidSchema),
    fromOtherProjects: z.array(authzBraidSchema),
  })
  .strict();
export interface AuthzProjectBraidsSchema extends Named<
  typeof authzProjectBraidsSchemaDefinition
> {}
export const authzProjectBraidsSchema: AuthzProjectBraidsSchema =
  authzProjectBraidsSchemaDefinition;
export type AuthzProjectBraids = z.infer<typeof authzProjectBraidsSchema>;

const authzBraidRemovedSchemaDefinition = z.object({ braidId: z.string().min(1) }).strict();
export interface AuthzBraidRemovedSchema extends Named<typeof authzBraidRemovedSchemaDefinition> {}
export const authzBraidRemovedSchema: AuthzBraidRemovedSchema = authzBraidRemovedSchemaDefinition;
export type AuthzBraidRemoved = z.infer<typeof authzBraidRemovedSchema>;
