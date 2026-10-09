/**
 * Render-only role overrides for traces emitted under the Scenario SDK: what a role reads as.
 */
import type { IconType } from "react-icons";
import { LuBot, LuFlaskConical, LuUser } from "react-icons/lu";

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
  { isScenario, isHumanCaller = false }: { isScenario: boolean; isHumanCaller?: boolean },
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
  // The user side of a scenario run is normally an LLM user-simulator. On a
  // voice "Call it myself" run it is the person who spoke the call, so it reads
  // as "You", keeping the same side, but a human icon and no flask (#8020).
  if (role === "user") {
    return isHumanCaller
      ? {
          displayRole: "assistant",
          label: "YOU",
          bubbleLabel: "You",
          Icon: LuUser,
        }
      : {
          displayRole: "assistant",
          label: "USER SIMULATOR",
          bubbleLabel: "User Simulator",
          Icon: LuFlaskConical,
        };
  }
  return {
    displayRole: "user",
    label: "AGENT",
    bubbleLabel: "Agent",
    Icon: LuBot,
  };
}
