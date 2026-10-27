import { HandledError, remediation } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { AgentType } from "./config/index.ts";

/** No agent with that id; ADR-045 maps it to 404 with actionable remediation. */
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

/** Voice agents are behind the project's release flag (AC29); a write that would leave one in a
 * project with the flag off is refused, as the run dialog and the drawer refuse it. */
export class VoiceAgentsDisabledError extends HandledError {
  declare readonly code: "voice_agents_disabled";

  constructor() {
    super("voice_agents_disabled", "Voice agents are not enabled for this project", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "VoiceAgentsDisabledError";
  }
}

/** Stored credentials stay at the address they were saved for: a test call, a run or an update
 * that would carry them elsewhere is refused, and the credential is re-entered for the new one. */
export class AgentStoredCredentialsDestinationError extends HandledError {
  declare readonly code: "agent_stored_credentials_destination_mismatch";

  constructor() {
    super(
      "agent_stored_credentials_destination_mismatch",
      "Stored credentials are only sent to the agent's saved address.",
      { httpStatus: 422, fault: "customer" },
    );
    this.name = "AgentStoredCredentialsDestinationError";
  }
}

/** Only the SDK may change connected-agent registration fields; callers may archive it. */
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

export class InvalidAgentConfigError extends HandledError {
  readonly name = "InvalidAgentConfigError";

  constructor(
    readonly agentType: AgentType,
    readonly issues?: unknown,
  ) {
    super(
      "invalid_agent_config",
      `The configuration is not valid for an agent of type "${agentType}".`,
      {
        httpStatus: 400,
        fault: "customer",
        meta: { agentType },
      },
    );
  }
}

export class AgentIsNotCopyError extends HandledError {
  readonly name = "AgentIsNotCopyError";

  constructor(
    readonly agentId: string,
    readonly projectId: string,
  ) {
    super(
      "agent_is_not_copy",
      `Agent "${agentId}" is not a copy and has no source to synchronize.`,
      {
        httpStatus: 400,
        fault: "customer",
        meta: { agentId, projectId },
      },
    );
  }
}

export class AgentSourceNotFoundError extends HandledError {
  readonly name = "AgentSourceNotFoundError";

  constructor(readonly sourceAgentId: string) {
    super("agent_source_not_found", `Source agent "${sourceAgentId}" was not found.`, {
      httpStatus: 404,
      fault: "customer",
      meta: { sourceAgentId },
    });
  }
}

export class AgentCopiesNotFoundError extends HandledError {
  readonly name = "AgentCopiesNotFoundError";

  constructor(readonly sourceAgentId: string) {
    super("agent_copies_not_found", `Agent "${sourceAgentId}" has no copies.`, {
      httpStatus: 400,
      fault: "customer",
      meta: { sourceAgentId },
    });
  }
}

export class AgentCopySelectionError extends HandledError {
  readonly name = "AgentCopySelectionError";

  constructor(readonly sourceAgentId: string) {
    super(
      "agent_copy_selection_invalid",
      `No valid copies of agent "${sourceAgentId}" were selected.`,
      {
        httpStatus: 400,
        fault: "customer",
        meta: { sourceAgentId },
      },
    );
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
  agentType: z.enum(["signature", "code", "workflow", "http", "connected", "voice"]),
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

const agentProblemSchemaDefinition = z.discriminatedUnion("error", [
  agentNotFoundProblemSchema,
  invalidAgentConfigProblemSchema,
  agentIsNotCopyProblemSchema,
  agentSourceNotFoundProblemSchema,
  agentCopiesNotFoundProblemSchema,
  agentCopySelectionProblemSchema,
]);
export interface AgentProblemSchema extends Named<typeof agentProblemSchemaDefinition> {}
export const agentProblemSchema: AgentProblemSchema = agentProblemSchemaDefinition;

export type AgentProblem = z.infer<typeof agentProblemSchema>;

export class AgentAlreadyExistsError extends HandledError {
  readonly name = "AgentAlreadyExistsError";

  constructor(
    readonly agentId: string,
    readonly projectId: string,
  ) {
    super("agent_already_exists", "An agent with this identifier already exists.", {
      httpStatus: 409,
      fault: "customer",
      meta: { agentId, projectId },
    });
  }
}

export class AgentHttpTestingUnavailableError extends HandledError {
  constructor() {
    super(
      "agent_http_testing_unavailable",
      "HTTP agent testing is not configured in this process.",
      {
        httpStatus: 503,
        fault: "platform",
      },
    );
  }
}

export class AgentConnectionsUnavailableError extends HandledError {
  constructor() {
    super("agent_connections_unavailable", "Connected agents are not configured in this process.", {
      httpStatus: 503,
      fault: "platform",
    });
  }
}

export class AgentSourcePermissionDeniedError extends HandledError {
  constructor() {
    super(
      "agent_source_permission_denied",
      "You do not have permission to manage evaluations in the source project",
      {
        httpStatus: 401,
        fault: "customer",
      },
    );
  }
}

/** No version of the agent answers the label or number asked for. */
export class AgentVersionNotFoundError extends HandledError {
  declare readonly code: "agent_version_not_found";

  constructor({ agentId, label, version }: { agentId: string; label?: string; version?: number }) {
    super(
      "agent_version_not_found",
      label
        ? `Agent "${agentId}" has no version labelled "${label}".`
        : `Agent "${agentId}" has no version ${version ?? "with that number"}.`,
      {
        httpStatus: 404,
        fault: "customer",
        meta: { agentId, ...(label ? { label } : {}), ...(version ? { version } : {}) },
      },
    );
    this.name = "AgentVersionNotFoundError";
  }
}

/** A label name the deploy rules refuse (prompt tag rules: lowercase, not a number, not latest). */
export class AgentLabelInvalidError extends HandledError {
  declare readonly code: "agent_label_invalid";

  constructor({ label, reason }: { label: string; reason: string }) {
    super("agent_label_invalid", `Invalid label "${label}". ${reason}`, {
      httpStatus: 422,
      fault: "customer",
      meta: { label, reason },
    });
    this.name = "AgentLabelInvalidError";
  }
}

/** A read named a label and a version at once, in the address or beside it. */
export class AgentVersionSelectorConflictError extends HandledError {
  declare readonly code: "agent_version_selector_conflict";

  constructor() {
    super(
      "agent_version_selector_conflict",
      "Name a label or a version, not both, and not in the address and the query at once.",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "AgentVersionSelectorConflictError";
  }
}

/** Archiving an agent that a deploy label points at needs `agents:deploy`. */
export class AgentDeployedLabelProtectedError extends HandledError {
  declare readonly code: "agent_deployed_label_protected";

  constructor({ agentId, labels }: { agentId: string; labels: string[] }) {
    super(
      "agent_deployed_label_protected",
      `Agent "${agentId}" is deployed as ${labels.join(", ")}; archiving it needs the agents:deploy permission.`,
      { httpStatus: 403, fault: "customer", meta: { agentId, labels } },
    );
    this.name = "AgentDeployedLabelProtectedError";
  }
}

/** Connected agents are versioned by the code that registers them, so they carry no labels. */
export class AgentVersionUnsupportedError extends HandledError {
  declare readonly code: "agent_version_unsupported";

  constructor({ agentId }: { agentId: string }) {
    super(
      "agent_version_unsupported",
      `Agent "${agentId}" is a connected agent; its versions live in the code that registers it.`,
      { httpStatus: 422, fault: "customer", meta: { agentId } },
    );
    this.name = "AgentVersionUnsupportedError";
  }
}
