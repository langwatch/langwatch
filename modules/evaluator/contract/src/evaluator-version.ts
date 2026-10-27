import type { Named } from "@langwatch/module";
import { z } from "zod";

import { evaluatorTypeSchema } from "./evaluator.ts";

/** The labels the deploy dialog offers before any is assigned, as prompts seed them. */
export const EVALUATOR_SEEDED_LABELS = ["production", "staging"] as const;
/** Always the evaluator row itself: never stored, never assigned. */
export const EVALUATOR_LATEST_LABEL = "latest";

const LABEL_NAME = /^[a-z][a-z0-9_-]*$/;
const NUMERIC = /^\d+$/;

export type EvaluatorLabelCheck = { valid: true } | { valid: false; reason: string };

/** Whether a label name may be assigned, and why not. Same rules as prompt tags. */
export function checkEvaluatorLabel(label: string): EvaluatorLabelCheck {
  if (label === EVALUATOR_LATEST_LABEL) {
    return { valid: false, reason: `"latest" always points at the newest version.` };
  }
  if (NUMERIC.test(label)) {
    return { valid: false, reason: "A label cannot be a number; numbers pick versions." };
  }
  if (!LABEL_NAME.test(label)) {
    return {
      valid: false,
      reason:
        "A label starts with a lowercase letter and holds only lowercase letters, digits, hyphens or underscores.",
    };
  }
  if (label.length > 64) return { valid: false, reason: "A label is at most 64 characters." };
  return { valid: true };
}

export type EvaluatorAddress = {
  idOrSlug: string;
  label: string | undefined;
  version: number | undefined;
  hadSuffix: boolean;
};

/** `toxicity`, `toxicity:production`, `toxicity:2` or `toxicity:latest`, by id or slug. */
export function parseEvaluatorAddress(address: string): EvaluatorAddress {
  const colon = address.lastIndexOf(":");
  if (colon <= 0 || colon === address.length - 1) {
    return { idOrSlug: address, label: void 0, version: void 0, hadSuffix: false };
  }
  const idOrSlug = address.slice(0, colon);
  const suffix = address.slice(colon + 1);
  if (suffix === EVALUATOR_LATEST_LABEL) {
    return { idOrSlug, label: void 0, version: void 0, hadSuffix: true };
  }
  const version = Number(suffix);
  if (Number.isInteger(version) && version > 0) {
    return { idOrSlug, label: void 0, version, hadSuffix: true };
  }
  return { idOrSlug, label: suffix, version: void 0, hadSuffix: true };
}

export const evaluatorVersionAuthorKindSchema = z.enum(["user", "api_key", "system"]);
export type EvaluatorVersionAuthorKind = z.infer<typeof evaluatorVersionAuthorKindSchema>;

/** Who wrote a change: a user id, or none with the kind of caller that wrote it. */
export type EvaluatorWriteAuthor = {
  authorId: string | null;
  authorKind: EvaluatorVersionAuthorKind;
};

/**
 * Who asks, as the door authenticated them. A version's author and the deploy check on a
 * delete read it; absent on a peer's cascade, which its own owner already authorised.
 */
export type EvaluatorCaller =
  | { type: "user"; id: string }
  | { type: "api_key"; id: string }
  /** A credential the door could not attribute to a user or key; it holds no deploy permission. */
  | { type: "unattributed" }
  | { type: "system" };

export function evaluatorWriteAuthorOf(caller: EvaluatorCaller | undefined): EvaluatorWriteAuthor {
  if (caller?.type === "user") return { authorId: caller.id, authorKind: "user" };
  if (caller?.type === "api_key" || caller?.type === "unattributed") {
    return { authorId: null, authorKind: "api_key" };
  }
  return { authorId: null, authorKind: "system" };
}

const evaluatorPersonSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

const evaluatorVersionSchemaDefinition = z.object({
  id: z.string(),
  evaluatorId: z.string(),
  projectId: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
  type: evaluatorTypeSchema,
  config: z.record(z.string(), z.unknown()),
  workflowId: z.string().nullable(),
  commitMessage: z.string().nullable(),
  authorId: z.string().nullable(),
  authorKind: evaluatorVersionAuthorKindSchema.nullable(),
  author: evaluatorPersonSchema.nullable(),
  createdAt: z.date(),
  labels: z.array(z.string()),
});
export interface EvaluatorVersionSchema extends Named<typeof evaluatorVersionSchemaDefinition> {}
export const evaluatorVersionSchema: EvaluatorVersionSchema = evaluatorVersionSchemaDefinition;
export type EvaluatorVersion = z.infer<typeof evaluatorVersionSchema>;

const evaluatorLabelSchemaDefinition = z.object({
  label: z.string(),
  versionId: z.string(),
  version: z.number().int().positive(),
  updatedAt: z.date(),
  updatedById: z.string().nullable(),
});
export interface EvaluatorLabelSchema extends Named<typeof evaluatorLabelSchemaDefinition> {}
export const evaluatorLabelSchema: EvaluatorLabelSchema = evaluatorLabelSchemaDefinition;
export type EvaluatorLabel = z.infer<typeof evaluatorLabelSchema>;

const evaluatorVersionsSchemaDefinition = z.object({
  versions: evaluatorVersionSchema.array(),
  labels: evaluatorLabelSchema.array(),
  /** The labels the deploy dialog offers: the seeded ones and every one the evaluator carries. */
  availableLabels: z.array(z.string()),
});
export interface EvaluatorVersionsSchema extends Named<typeof evaluatorVersionsSchemaDefinition> {}
export const evaluatorVersionsSchema: EvaluatorVersionsSchema = evaluatorVersionsSchemaDefinition;
export type EvaluatorVersions = z.infer<typeof evaluatorVersionsSchema>;

/** A label or a version number; neither reads the latest. */
const evaluatorVersionSelectorSchemaDefinition = z.object({
  label: z.string().min(1).max(64).optional(),
  version: z.coerce.number().int().positive().optional(),
});
export interface EvaluatorVersionSelectorSchema extends Named<
  typeof evaluatorVersionSelectorSchemaDefinition
> {}
export const evaluatorVersionSelectorSchema: EvaluatorVersionSelectorSchema =
  evaluatorVersionSelectorSchemaDefinition;
export type EvaluatorVersionSelector = z.infer<typeof evaluatorVersionSelectorSchema>;

const evaluatorVersionsInputSchemaDefinition = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
});
export interface EvaluatorVersionsInputSchema extends Named<
  typeof evaluatorVersionsInputSchemaDefinition
> {}
export const evaluatorVersionsInputSchema: EvaluatorVersionsInputSchema =
  evaluatorVersionsInputSchemaDefinition;

const assignEvaluatorLabelInputSchemaDefinition = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
  label: z.string().min(1).max(64),
  version: z.number().int().positive(),
});
export interface AssignEvaluatorLabelInputSchema extends Named<
  typeof assignEvaluatorLabelInputSchemaDefinition
> {}
export const assignEvaluatorLabelInputSchema: AssignEvaluatorLabelInputSchema =
  assignEvaluatorLabelInputSchemaDefinition;
export type AssignEvaluatorLabelInput = z.infer<typeof assignEvaluatorLabelInputSchema>;

const removeEvaluatorLabelInputSchemaDefinition = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
  label: z.string().min(1).max(64),
});
export interface RemoveEvaluatorLabelInputSchema extends Named<
  typeof removeEvaluatorLabelInputSchemaDefinition
> {}
export const removeEvaluatorLabelInputSchema: RemoveEvaluatorLabelInputSchema =
  removeEvaluatorLabelInputSchemaDefinition;
export type RemoveEvaluatorLabelInput = z.infer<typeof removeEvaluatorLabelInputSchema>;
