/**
 * Render-only role overrides for traces emitted under the Scenario SDK.
 *
 * In a Scenario run the chat data flips relative to a normal trace: the
 * `user` role messages are produced by an LLM driving the conversation as
 * the simulated user, and the `assistant` role messages are emitted by the
 * agent under test. Reading that raw trace feels backwards — the agent
 * (the subject of the trace) shows up as "assistant" while the simulator
 * shows up as "user".
 *
 * This helper visually swaps user ↔ assistant sides in the v2 trace drawer
 * so the agent reads as the trace's "user" (left/blue) and the simulator
 * reads as the "assistant" (right/purple, marked with a flask icon to
 * signal it isn't a real human). The underlying chat payloads, exports,
 * and parsing stay untouched.
 */
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { IconType } from "react-icons";
import { LuBot, LuFlaskConical, LuUser } from "react-icons/lu";

const ScenarioRoleContext = createContext(false);

export function ScenarioRoleProvider({
  isScenario,
  children,
}: {
  isScenario: boolean;
  children: ReactNode;
}) {
  return (
    <ScenarioRoleContext.Provider value={isScenario}>
      {children}
    </ScenarioRoleContext.Provider>
  );
}

export function useIsScenarioRole(): boolean {
  return useContext(ScenarioRoleContext);
}

export type SourceRole = "user" | "assistant";
export type DisplayRole = "user" | "assistant";

export interface DisplayRoleVisuals {
  /** Side / tone the bubble or chip should render as. */
  displayRole: DisplayRole;
  /** UPPERCASE label, suitable for role chips. */
  label: string;
  /** Title-cased label, suitable for chat-bubble headers. */
  bubbleLabel: string;
  /** Icon component (react-icons/lu). */
  Icon: IconType;
}

export function getDisplayRoleVisuals(
  role: SourceRole,
  { isScenario }: { isScenario: boolean },
): DisplayRoleVisuals {
  if (!isScenario) {
    return role === "user"
      ? {
          displayRole: "user",
          label: "USER",
          bubbleLabel: "User",
          Icon: LuUser,
        }
      : {
          displayRole: "assistant",
          label: "ASSISTANT",
          bubbleLabel: "Assistant",
          Icon: LuBot,
        };
  }
  return role === "user"
    ? {
        displayRole: "assistant",
        label: "SIMULATOR",
        bubbleLabel: "Simulator",
        Icon: LuFlaskConical,
      }
    : {
        displayRole: "user",
        label: "AGENT",
        bubbleLabel: "Agent",
        Icon: LuBot,
      };
}

/** Hook variant — consumes scenario context and returns visuals in one call. */
export function useDisplayRoleVisuals(role: SourceRole): DisplayRoleVisuals {
  const isScenario = useIsScenarioRole();
  return getDisplayRoleVisuals(role, { isScenario });
}
