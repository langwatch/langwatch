import { HandledError, remediation } from "@langwatch/handled-error";
import type { AgentType } from "./config";
import { z } from "zod";

/**
 * No agent with that id in the project.
 *
 * Handled (ADR-045): a caller can act on it — check the id, or list the
 * project's agents — so it answers 404 at every boundary with its own
 * remediation instead of degrading to an unknown error.
 */
export class AgentNotFoundError extends HandledError {
  declare readonly code: "agent_not_found";

  constructor(
    readonly agentId: string,
    readonly projectId?: string,
  ) {
    super(
      "agent_not_found",
      projectId
        ? `Agent "${agentId}" was not found in project "${projectId}".`
        : `Agent "${agentId}" was not found.`,
      {
        httpStatus: 404,
        fault: "customer",
        meta: { agentId, ...(projectId ? { projectId } : {}) },
        ...remediation("agent_not_found"),
      },
    );
    this.name = "AgentNotFoundError";
  }
}

/**
 * Refuses a test run of an agent that cannot be run as it is: a kind no
 * scenario runs against, or a configuration the run cannot be prepared from.
 * `reason` carries the same message a queued run would fail with.
 */
export class AgentTestRefusedError extends HandledError {
  declare readonly code: "agent_test_refused";

  constructor({ reason }: { reason: string }) {
    super("agent_test_refused", "This agent cannot be tested as it is set up.", {
      httpStatus: 422,
      fault: "customer",
      meta: { reason },
      ...remediation("agent_test_refused"),
    });
    this.name = "AgentTestRefusedError";
  }
}

/**
 * Refuses a write that only the SDK may make on a connected agent.
 *
 * A connected agent is registered from the process that runs it, so its type,
 * its name, its environment and its parameters are what that process declared.
 * A caller may archive it; everything else is the SDK's to change, by
 * registering again.
 */
export class AgentRegisterOnlyError extends HandledError {
  declare readonly code: "agent_register_only";

  constructor() {
    super(
      "agent_register_only",
      "A connected agent is registered from code with the SDK. It cannot be edited here.",
      {
        httpStatus: 422,
        fault: "customer",
        ...remediation("agent_register_only"),
      },
    );
    this.name = "AgentRegisterOnlyError";
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
  agentType: z.enum(["signature", "code", "workflow", "http", "connected"]),
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
