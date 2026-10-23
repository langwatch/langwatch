import type { AuthzPermission } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * What the Studio code editor lets Langy do while it is open: read the code block and propose new
 * code for the reader to accept. No kind saves, runs, changes the language or the fields, and none
 * declares a backend, so none runs without an open editor.
 * @see specs/langy/langy-studio-code-blocks.feature
 */

/** The most code one proposal may carry, in UTF-8 bytes. */
export const STUDIO_CODE_MAX_BYTES = 32 * 1024;

/**
 * The largest read answer the editor hands Langy, in UTF-8 bytes of JSON: under the 64 KiB a
 * page action's result may hold, so code Langy can propose it can also read back.
 */
export const STUDIO_CODE_READ_MAX_BYTES = 60 * 1024;

/** The longest summary a proposal may carry. */
export const STUDIO_CODE_MAX_SUMMARY_LENGTH = 500;

const utf8 = new TextEncoder();

const codeFieldSchema = z.object({ identifier: z.string(), type: z.string() });

const studioCodeReadPayloadSchemaDefinition = z.object({}).strict();
export interface StudioCodeReadPayloadSchema extends Named<
  typeof studioCodeReadPayloadSchemaDefinition
> {}
export const studioCodeReadPayloadSchema: StudioCodeReadPayloadSchema =
  studioCodeReadPayloadSchemaDefinition;

const studioCodeReadResultSchemaDefinition = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  language: z.enum(["python", "javascript", "typescript"]),
  /** The buffer as the editor holds it, unsaved edits included; empty when `codeTooLarge`. */
  code: z.string(),
  /** The buffer is too large to hand over; Langy says so rather than propose blind. */
  codeTooLarge: z.boolean(),
  inputs: z.array(codeFieldSchema),
  outputs: z.array(codeFieldSchema),
  /** Names only: a secret's value never leaves the browser. */
  secretNames: z.array(z.string()),
  lastError: z.string().nullable(),
  hasUnsavedChanges: z.boolean(),
});
export interface StudioCodeReadResultSchema extends Named<
  typeof studioCodeReadResultSchemaDefinition
> {}
export const studioCodeReadResultSchema: StudioCodeReadResultSchema =
  studioCodeReadResultSchemaDefinition;

const studioCodeProposePayloadSchemaDefinition = z
  .object({
    code: z.string().refine((code) => utf8.encode(code).byteLength <= STUDIO_CODE_MAX_BYTES, {
      message: `The proposed code is over ${STUDIO_CODE_MAX_BYTES} bytes.`,
    }),
    summary: z.string().trim().min(1).max(STUDIO_CODE_MAX_SUMMARY_LENGTH),
  })
  .strict();
export interface StudioCodeProposePayloadSchema extends Named<
  typeof studioCodeProposePayloadSchemaDefinition
> {}
export const studioCodeProposePayloadSchema: StudioCodeProposePayloadSchema =
  studioCodeProposePayloadSchemaDefinition;

const studioCodeProposeResultSchemaDefinition = z.object({
  status: z.literal("awaiting_review"),
});
export interface StudioCodeProposeResultSchema extends Named<
  typeof studioCodeProposeResultSchemaDefinition
> {}
export const studioCodeProposeResultSchema: StudioCodeProposeResultSchema =
  studioCodeProposeResultSchemaDefinition;

export type StudioCodeReadResult = z.infer<typeof studioCodeReadResultSchema>;
export type StudioCodeProposal = z.infer<typeof studioCodeProposePayloadSchema>;
export type StudioCodeProposeResult = z.infer<typeof studioCodeProposeResultSchema>;

type StudioCodeActionDefinition = {
  payloadSchema: z.ZodTypeAny;
  resultSchema: z.ZodTypeAny;
  requiredPermission: AuthzPermission;
  executeBudgetMs: number;
};

/** Reading is viewing the workflow; proposing is editing it, even though the reader accepts. */
export const STUDIO_CODE_ACTIONS = {
  "studio.code.read": {
    payloadSchema: studioCodeReadPayloadSchema,
    resultSchema: studioCodeReadResultSchema,
    requiredPermission: "workflows:view",
    executeBudgetMs: 8_000,
  },
  "studio.code.propose": {
    payloadSchema: studioCodeProposePayloadSchema,
    resultSchema: studioCodeProposeResultSchema,
    requiredPermission: "workflows:manage",
    executeBudgetMs: 8_000,
  },
} as const satisfies Record<string, StudioCodeActionDefinition>;

export type StudioCodeActionKind = keyof typeof STUDIO_CODE_ACTIONS;

export const STUDIO_CODE_ACTION_KINDS = Object.keys(STUDIO_CODE_ACTIONS) as StudioCodeActionKind[];
