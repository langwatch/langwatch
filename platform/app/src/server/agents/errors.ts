import { HandledError } from "@langwatch/handled-error";
import { remediation } from "~/server/app-layer/error-remediation";

/**
 * Refuses a test run of an agent that cannot be run as it is: a kind no
 * scenario runs against, or a configuration the run cannot be prepared from.
 * `reason` carries the same message a queued run would fail with.
 */
export class AgentTestRefusedError extends HandledError {
  declare readonly code: "agent_test_refused";

  constructor({ reason }: { reason: string }) {
    super(
      "agent_test_refused",
      "This agent cannot be tested as it is set up.",
      {
        httpStatus: 422,
        fault: "customer",
        meta: { reason },
        ...remediation("agent_test_refused"),
      },
    );
    this.name = "AgentTestRefusedError";
  }
}

/**
 * No agent with that id in the project. A caller can act on it: check the
 * id, or list the project's agents. Answers 404 at every boundary.
 */
export class AgentNotFoundError extends HandledError {
  declare readonly code: "agent_not_found";

  constructor(message = "Agent not found") {
    super("agent_not_found", message, {
      httpStatus: 404,
      fault: "customer",
      ...remediation("agent_not_found"),
    });
    this.name = "AgentNotFoundError";
  }
}

/**
 * Refuses a user-set default value for a connected agent's parameter that the
 * current declaration cannot accept: an undeclared name, a secret parameter, a
 * value of the wrong type, or a value outside a declared option list.
 *
 * Validated at save time against what the agent declares right now, so a
 * refusal is something the user can act on: pick a declared parameter, or a
 * value the declaration allows. `reason` is a short customer-safe phrase.
 */
export class AgentParameterDefaultInvalidError extends HandledError {
  declare readonly code: "agent_parameter_default_invalid";

  constructor({ name, reason }: { name: string | null; reason: string }) {
    super(
      "agent_parameter_default_invalid",
      name
        ? `The default for "${name}" cannot be set: ${reason}`
        : `The default cannot be set: ${reason}`,
      {
        httpStatus: 422,
        fault: "customer",
        meta: { name, reason },
        ...remediation("agent_parameter_default_invalid"),
      },
    );
    this.name = "AgentParameterDefaultInvalidError";
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
