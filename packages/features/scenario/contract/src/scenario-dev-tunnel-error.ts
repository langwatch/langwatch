import { HandledError } from "@langwatch/handled-error";

/**
 * A scenario target still points at a local `langwatch agent dev` tunnel whose
 * developer session ended. This handled error owns the customer-safe copy and
 * remediation metadata used by both the run result and API error surfaces.
 */
export class AgentDevTunnelUnreachableError extends HandledError {
  declare readonly code: "agent_dev_tunnel_unreachable";

  constructor() {
    super(
      "agent_dev_tunnel_unreachable",
      "The agent points at a local development tunnel that is no longer " +
        "responding. The `langwatch agent dev` session that created it has " +
        "probably ended.",
      {
        httpStatus: 502,
        fault: "customer",
        tips: [
          "Run `langwatch agent dev` again on the machine that started the tunnel; a new session repoints the agent automatically",
          "If you are done developing locally, restore the agent's URL in its settings",
        ],
      },
    );
    this.name = "AgentDevTunnelUnreachableError";
  }
}
