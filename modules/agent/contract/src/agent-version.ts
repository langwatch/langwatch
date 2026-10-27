import type { Named } from "@langwatch/module";
import { z } from "zod";

import { agentTypeSchema } from "./config/index.ts";

/** The labels the deploy dialog offers before any is assigned, as prompts seed them. */
export const AGENT_SEEDED_LABELS = ["production", "staging"] as const;
/** Always the agent row itself: never stored, never assigned. */
export const AGENT_LATEST_LABEL = "latest";

const LABEL_NAME = /^[a-z][a-z0-9_-]*$/;
const NUMERIC = /^\d+$/;

/** Why a label name is refused, or null when it may be assigned. Same rules as prompt tags. */
export function agentLabelProblem(label: string): string | null {
  if (label === AGENT_LATEST_LABEL) return `"latest" always points at the newest version.`;
  if (NUMERIC.test(label)) return "A label cannot be a number; numbers pick versions.";
  if (!LABEL_NAME.test(label)) {
    return "A label starts with a lowercase letter and holds only lowercase letters, digits, hyphens or underscores.";
  }
  if (label.length > 64) return "A label is at most 64 characters.";
  return null;
}

export type AgentAddress = {
  id: string;
  label: string | undefined;
  version: number | undefined;
  hadSuffix: boolean;
};

/** `agent_1`, `agent_1:production`, `agent_1:3` or `agent_1:latest`. */
export function parseAgentAddress(address: string): AgentAddress {
  const colon = address.lastIndexOf(":");
  if (colon <= 0 || colon === address.length - 1) {
    return { id: address, label: void 0, version: void 0, hadSuffix: false };
  }
  const id = address.slice(0, colon);
  const suffix = address.slice(colon + 1);
  if (suffix === AGENT_LATEST_LABEL) return { id, label: void 0, version: void 0, hadSuffix: true };
  const version = Number(suffix);
  if (Number.isInteger(version) && version > 0) {
    return { id, label: void 0, version, hadSuffix: true };
  }
  return { id, label: suffix, version: void 0, hadSuffix: true };
}

export const agentVersionAuthorKindSchema = z.enum(["user", "api_key", "system"]);
export type AgentVersionAuthorKind = z.infer<typeof agentVersionAuthorKindSchema>;

/** Who wrote a change: a user id, or none with the kind of caller that wrote it. */
export type AgentWriteAuthor = { authorId: string | null; authorKind: AgentVersionAuthorKind };

const agentPersonSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

const agentVersionSchemaDefinition = z.object({
  id: z.string(),
  agentId: z.string(),
  projectId: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
  type: agentTypeSchema,
  config: z.record(z.string(), z.unknown()),
  workflowId: z.string().nullable(),
  commitMessage: z.string().nullable(),
  authorId: z.string().nullable(),
  authorKind: agentVersionAuthorKindSchema.nullable(),
  author: agentPersonSchema.nullable(),
  createdAt: z.date(),
  labels: z.array(z.string()),
});
export interface AgentVersionSchema extends Named<typeof agentVersionSchemaDefinition> {}
export const agentVersionSchema: AgentVersionSchema = agentVersionSchemaDefinition;
export type AgentVersion = z.infer<typeof agentVersionSchema>;

const agentLabelSchemaDefinition = z.object({
  label: z.string(),
  versionId: z.string(),
  version: z.number().int().positive(),
  updatedAt: z.date(),
  updatedById: z.string().nullable(),
});
export interface AgentLabelSchema extends Named<typeof agentLabelSchemaDefinition> {}
export const agentLabelSchema: AgentLabelSchema = agentLabelSchemaDefinition;
export type AgentLabel = z.infer<typeof agentLabelSchema>;

const agentVersionsSchemaDefinition = z.object({
  versions: agentVersionSchema.array(),
  labels: agentLabelSchema.array(),
  /** The labels the deploy dialog offers: the seeded ones and every one the agent carries. */
  availableLabels: z.array(z.string()),
});
export interface AgentVersionsSchema extends Named<typeof agentVersionsSchemaDefinition> {}
export const agentVersionsSchema: AgentVersionsSchema = agentVersionsSchemaDefinition;
export type AgentVersions = z.infer<typeof agentVersionsSchema>;

/** A label or a version number; neither reads the latest. */
const agentVersionSelectorSchemaDefinition = z.object({
  label: z.string().min(1).max(64).optional(),
  version: z.coerce.number().int().positive().optional(),
});
export interface AgentVersionSelectorSchema extends Named<
  typeof agentVersionSelectorSchemaDefinition
> {}
export const agentVersionSelectorSchema: AgentVersionSelectorSchema =
  agentVersionSelectorSchemaDefinition;
export type AgentVersionSelector = z.infer<typeof agentVersionSelectorSchema>;

const agentVersionInputSchemaDefinition = z.object({
  projectId: z.string(),
  agentId: z.string(),
  ...agentVersionSelectorSchema.shape,
});
export interface AgentVersionInputSchema extends Named<typeof agentVersionInputSchemaDefinition> {}
export const agentVersionInputSchema: AgentVersionInputSchema = agentVersionInputSchemaDefinition;
export type AgentVersionInput = z.infer<typeof agentVersionInputSchema>;

const assignAgentLabelInputSchemaDefinition = z.object({
  projectId: z.string(),
  agentId: z.string(),
  label: z.string().min(1).max(64),
  version: z.number().int().positive(),
});
export interface AssignAgentLabelInputSchema extends Named<
  typeof assignAgentLabelInputSchemaDefinition
> {}
export const assignAgentLabelInputSchema: AssignAgentLabelInputSchema =
  assignAgentLabelInputSchemaDefinition;
export type AssignAgentLabelInput = z.infer<typeof assignAgentLabelInputSchema>;

const removeAgentLabelInputSchemaDefinition = z.object({
  projectId: z.string(),
  agentId: z.string(),
  label: z.string().min(1).max(64),
});
export interface RemoveAgentLabelInputSchema extends Named<
  typeof removeAgentLabelInputSchemaDefinition
> {}
export const removeAgentLabelInputSchema: RemoveAgentLabelInputSchema =
  removeAgentLabelInputSchemaDefinition;
export type RemoveAgentLabelInput = z.infer<typeof removeAgentLabelInputSchema>;

/** A REST label move: the version travels in the body, the label in the path. */
const agentLabelRestBodySchemaDefinition = z.object({
  version: z.number().int().positive().describe("The version number the label points at."),
});
export interface AgentLabelRestBodySchema extends Named<
  typeof agentLabelRestBodySchemaDefinition
> {}
export const agentLabelRestBodySchema: AgentLabelRestBodySchema =
  agentLabelRestBodySchemaDefinition;

const agentLabelRestParamsSchemaDefinition = z.object({
  id: z.string().min(1).describe("The agent id."),
  label: z.string().min(1).max(64).describe("The deploy label, for example production."),
});
export interface AgentLabelRestParamsSchema extends Named<
  typeof agentLabelRestParamsSchemaDefinition
> {}
export const agentLabelRestParamsSchema: AgentLabelRestParamsSchema =
  agentLabelRestParamsSchemaDefinition;

/** What a reader names: the person behind a created or updated row. */
const agentPersonViewSchemaDefinition = z.object({ id: z.string(), name: z.string().nullable() });
export interface AgentPersonViewSchema extends Named<typeof agentPersonViewSchemaDefinition> {}
export const agentPersonViewSchema: AgentPersonViewSchema = agentPersonViewSchemaDefinition;
export type AgentPersonView = z.infer<typeof agentPersonViewSchema>;

/**
 * Who asks, as the door authenticated them. A version's author and the deploy check on an
 * archive read it; absent on a peer's cascade, which its own owner already authorised.
 */
export type AgentCaller =
  | { type: "user"; id: string }
  | { type: "api_key"; id: string }
  | { type: "system" };

export function agentWriteAuthorOf(caller: AgentCaller | undefined): AgentWriteAuthor {
  if (caller?.type === "user") return { authorId: caller.id, authorKind: "user" };
  if (caller?.type === "api_key") return { authorId: null, authorKind: "api_key" };
  return { authorId: null, authorKind: "system" };
}
