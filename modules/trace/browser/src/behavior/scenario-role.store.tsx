import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  type DisplayRoleVisuals,
  getDisplayRoleVisuals,
  type SourceRole,
} from "@langwatch/design-system/role-visuals";
/**
 * Render-only role overrides for traces emitted under the Scenario SDK.
 */
import { type ReactNode, useEffect } from "react";

interface ScenarioRoleState {
  isScenario: boolean;
  /** True when the "user" side of this run is a real person who spoke on the
   *  call (a voice "Call it myself" run), not an LLM user-simulator. Their
   *  turns read as "You" rather than "User Simulator" (#8020). */
  isHumanCaller: boolean;
  setScenarioRole: (value: { isScenario: boolean; isHumanCaller: boolean }) => void;
}

const useScenarioRoleStore = defineSlice<ScenarioRoleState>({
  name: "trace:scenario-role",
  create: (set) => ({
    isScenario: false,
    isHumanCaller: false,
    setScenarioRole: (value) => set(value),
  }),
});

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

/** Hook variant — consumes scenario state and returns visuals in one call. */
export function useDisplayRoleVisuals(role: SourceRole): DisplayRoleVisuals {
  const isScenario = useIsScenarioRole();
  const isHumanCaller = useIsHumanCaller();
  return getDisplayRoleVisuals(role, { isScenario, isHumanCaller });
}
