/**
 * Available sources for scenario input mapping.
 *
 * These represent the three pieces of scenario context that can be
 * mapped to agent input fields during execution.
 */

import type { AvailableSource } from "~/components/variables/VariableMappingInput";

/**
 * The scenario source exposes three leaf fields:
 * - `scenario_message` — the user simulator's latest message content
 * - `conversation_history` — the full messages array serialized as JSON
 * - `thread_id` — the conversation thread identifier
 */
export const SCENARIO_SOURCES: AvailableSource[] = [
  {
    id: "scenario",
    name: "Scenario",
    type: "evaluator",
    fields: [
      {
        name: "scenario_message",
        label: "Scenario message",
        type: "str",
      },
      {
        name: "conversation_history",
        label: "Conversation history",
        type: "str",
      },
      {
        name: "thread_id",
        label: "Thread ID",
        type: "str",
      },
    ],
  },
];
