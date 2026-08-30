import { HandledError } from "@langwatch/handled-error";
import { remediation } from "~/server/app-layer/error-remediation";

/**
 * Domain error thrown when an agent cannot be found.
 * The route handler translates this to a 404 HTTP response.
 */
export class AgentNotFoundError extends Error {
  constructor(message = "Agent not found") {
    super(message);
    this.name = "AgentNotFoundError";
  }
}

/**
 * Refuses a write that only the SDK may make on a connected agent.
 *
 * A connected agent is registered from the process that runs it, so its type,
 * its name, its environment and its parameters are what that process declared.
 * A caller may archive it and edit its description; everything else is the
 * SDK's to change, by registering again.
 */
export class AgentRegisterOnlyError extends HandledError {
  declare readonly code: "agent_register_only";

  constructor() {
    super(
      "agent_register_only",
      "A connected agent is registered from code with the SDK. Only its description can be edited here.",
      {
        httpStatus: 422,
        fault: "customer",
        ...remediation("agent_register_only"),
      },
    );
    this.name = "AgentRegisterOnlyError";
  }
}
