import { nanoid } from "nanoid";

/** The platform's agent-id scheme used by legacy transport adapters. */
export function nextAgentId(): string {
  return `agent_${nanoid()}`;
}
