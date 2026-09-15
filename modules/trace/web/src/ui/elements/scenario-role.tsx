/**
 * Render-only role overrides for traces emitted under the Scenario SDK.
 */
import { type ReactNode, useEffect } from "react";
import type { IconType } from "react-icons";
import { LuBot, LuFlaskConical, LuUser } from "react-icons/lu";
import { create } from "zustand";

interface ScenarioRoleState {
  isScenario: boolean;
  /** True when the "user" side of this run is a real person who spoke on the
   *  call (a voice "Call it myself" run), not an LLM user-simulator. Their
   *  turns read as "You" rather than "User Simulator" (#8020). */
  isHumanCaller: boolean;
  setScenarioRole: (value: {
    isScenario: boolean;
    isHumanCaller: boolean;
  }) => void;
}

const useScenarioRoleStore = create<ScenarioRoleState>((set) => ({
  isScenario: false,
  isHumanCaller: false,
  setScenarioRole: (value) => set(value),
}));

/**
 * Sets the scenario flags for the lifetime of the wrapping component.
 * Replaces a prior React Context (banned by traces-v2 STANDARDS §2). Only
 * one drawer mounts at a time, so the single shared store is safe.
 */
export function ScenarioRoleProvider({
  isScenario,
  isHumanCaller = false,
  children,
}: {
  isScenario: boolean;
  isHumanCaller?: boolean;
  children: ReactNode;
}) {
  const setScenarioRole = useScenarioRoleStore((s) => s.setScenarioRole);
  useEffect(() => {
    setScenarioRole({ isScenario, isHumanCaller });
    return () => setScenarioRole({ isScenario: false, isHumanCaller: false });
  }, [isScenario, isHumanCaller, setScenarioRole]);
  return <>{children}</>;
}

export function useIsScenarioRole(): boolean {
  return useScenarioRoleStore((s) => s.isScenario);
}

export function useIsHumanCaller(): boolean {
  return useScenarioRoleStore((s) => s.isHumanCaller);
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
  {
    isScenario,
    isHumanCaller = false,
  }: { isScenario: boolean; isHumanCaller?: boolean },
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

/** Hook variant — consumes scenario state and returns visuals in one call. */
export function useDisplayRoleVisuals(role: SourceRole): DisplayRoleVisuals {
  const isScenario = useIsScenarioRole();
  const isHumanCaller = useIsHumanCaller();
  return getDisplayRoleVisuals(role, { isScenario, isHumanCaller });
}
