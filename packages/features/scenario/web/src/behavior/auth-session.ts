/**
 * `useSession`, as the call sites that came across from the platform spell it.
 *
 * The identity wire is `better-auth`, it lives in the application, and handing a
 * second client to a feature package would mean a second transport over the same
 * cookie. The reader arrives on the host port instead, and the one shape these
 * call sites read — `data.user.id`, to tell their own runs from someone else's —
 * is the same one the application hook returned.
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
