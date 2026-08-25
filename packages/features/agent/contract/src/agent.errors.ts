import type { AgentType } from "./config";
import { z } from "zod";

export class AgentNotFoundError extends Error {
  readonly name = "AgentNotFoundError";

  constructor(
    readonly agentId: string,
    readonly projectId?: string,
  ) {
    let message = `Agent "${agentId}" was not found.`;
    if (projectId) {
      message = `Agent "${agentId}" was not found in project "${projectId}".`;
    }
    super(message);
  }
}

export class InvalidAgentConfigError extends Error {
  readonly name = "InvalidAgentConfigError";

  constructor(
    readonly agentType: AgentType,
    readonly issues?: unknown,
  ) {
    super(`The configuration is not valid for an agent of type "${agentType}".`);
  }
}

export class AgentIsNotCopyError extends Error {
  readonly name = "AgentIsNotCopyError";

  constructor(
    readonly agentId: string,
    readonly projectId: string,
  ) {
    super(`Agent "${agentId}" is not a copy and has no source to synchronize.`);
  }
}

export class AgentSourceNotFoundError extends Error {
  readonly name = "AgentSourceNotFoundError";

  constructor(readonly sourceAgentId: string) {
    super(`Source agent "${sourceAgentId}" was not found.`);
  }
}

export class AgentCopiesNotFoundError extends Error {
  readonly name = "AgentCopiesNotFoundError";

  constructor(readonly sourceAgentId: string) {
    super(`Agent "${sourceAgentId}" has no copies.`);
  }
}

export class AgentCopySelectionError extends Error {
  readonly name = "AgentCopySelectionError";

  constructor(readonly sourceAgentId: string) {
    super(`No valid copies of agent "${sourceAgentId}" were selected.`);
  }
}

const agentNotFoundProblemSchema = z.object({
  error: z.literal("agent_not_found"),
  message: z.string(),
  agentId: z.string(),
  projectId: z.string().optional(),
});

const invalidAgentConfigProblemSchema = z.object({
  error: z.literal("invalid_agent_config"),
  message: z.string(),
  agentType: z.enum(["signature", "code", "workflow", "http"]),
  issues: z.unknown().optional(),
});

const agentIsNotCopyProblemSchema = z.object({
  error: z.literal("agent_is_not_copy"),
  message: z.string(),
  agentId: z.string(),
  projectId: z.string(),
});

const agentSourceNotFoundProblemSchema = z.object({
  error: z.literal("agent_source_not_found"),
  message: z.string(),
  sourceAgentId: z.string(),
});

const agentCopiesNotFoundProblemSchema = z.object({
  error: z.literal("agent_copies_not_found"),
  message: z.string(),
  sourceAgentId: z.string(),
});

const agentCopySelectionProblemSchema = z.object({
  error: z.literal("agent_copy_selection_invalid"),
  message: z.string(),
  sourceAgentId: z.string(),
});

export const agentProblemSchema = z.discriminatedUnion("error", [
  agentNotFoundProblemSchema,
  invalidAgentConfigProblemSchema,
  agentIsNotCopyProblemSchema,
  agentSourceNotFoundProblemSchema,
  agentCopiesNotFoundProblemSchema,
  agentCopySelectionProblemSchema,
]);

export type AgentProblem = z.infer<typeof agentProblemSchema>;
