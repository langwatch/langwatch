/**
 * `useSession`, as the call sites that came across from the platform spell it.
 */

import { useMemo } from "react";
import { type ScenarioHostUser, useOptionalScenarioHost } from "../model/scenario-host";

export type ScenarioSessionReading = {
  data: { user: ScenarioHostUser } | null;
  status: "authenticated" | "unauthenticated";
};

export function useSession(): ScenarioSessionReading {
  const host = useOptionalScenarioHost();
  const user = host?.currentUser();
  return useMemo(
    () =>
      user
        ? { data: { user }, status: "authenticated" as const }
        : { data: null, status: "unauthenticated" as const },
    [user],
  );
}
