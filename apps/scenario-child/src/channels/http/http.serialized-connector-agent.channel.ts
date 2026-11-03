/**
 * The Scenario Connector agent as the scenario library calls it (ADR-194): each turn runs the
 * agent's call block in the code runner. The blocks run there only; this process evaluates none.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";

import type { ConnectorMessage } from "../../rules/connector-block.rules.ts";
import type { ScenarioConnectorService } from "../../services/scenario-connector.service.ts";
import { SerializedAgentChannel } from "../serialized-agent.channel.ts";

function textOf(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

export class HttpSerializedConnectorAgentChannel extends SerializedAgentChannel {
  static create(options: {
    connector: ScenarioConnectorService;
  }): HttpSerializedConnectorAgentChannel {
    return new HttpSerializedConnectorAgentChannel(options.connector);
  }

  role = AgentRole.AGENT;

  /** The run's blocks; also the caller of its setup and teardown hooks. */
  readonly connector: ScenarioConnectorService;

  private constructor(connector: ScenarioConnectorService) {
    super();
    this.name = "SerializedConnectorAgentAdapter";
    this.connector = connector;
  }

  /** The last user message as the call block's `message`, the whole conversation as `history`. */
  async call(input: AgentInput): Promise<string> {
    const history: ConnectorMessage[] = input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const lastUser = input.messages.findLast((message) => message.role === "user");
    return this.connector.callTurn({ message: textOf(lastUser?.content), history });
  }
}
