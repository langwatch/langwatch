import type { AuthzPermission } from "@langwatch/authorization";
import { useCallback } from "react";

import { useScenarioHost } from "../model/scenario-host.ts";

/**
 * The registry type makes a typo'd permission fail the build. The answer is
 * the session's, through scenario's host: no grant read of its own (ADR-092 §5).
 */
export function useCan() {
  const host = useScenarioHost();
  const can = useCallback(
    (permission: AuthzPermission): boolean => host.hasPermission(permission),
    [host],
  );
  return { can };
}
