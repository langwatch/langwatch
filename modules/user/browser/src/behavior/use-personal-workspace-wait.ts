/** Holds personal actions while the first visit's personal workspace is still being created. */

import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { useState } from "react";

import { api } from "./personal-workspace-api.ts";

export const PERSONAL_WORKSPACE_WAIT_HINT = "Setting up your workspace. This takes a moment.";

export function isPersonalWorkspacePending(error: unknown): boolean {
  return readHandledError(error)?.code === "personal_workspace_pending";
}

/**
 * `waiting` comes from the personal-context read, which PROJECT_CREATED invalidates;
 * `absorb` takes a refused action's error and answers whether it was the pending workspace.
 */
export function usePersonalWorkspaceWait({ organizationId }: { organizationId: string }) {
  const utils = api.useUtils();
  const [refused, setRefused] = useState(false);
  const context = api.routingPolicy.personalContext.useQuery(
    { organizationId },
    { enabled: refused && !!organizationId, refetchOnWindowFocus: false },
  );
  const waiting = isPersonalWorkspacePending(context.error) || (refused && context.isFetching);
  const absorb = (error: unknown): boolean => {
    if (!isPersonalWorkspacePending(error)) return false;
    setRefused(true);
    void utils.routingPolicy.personalContext.invalidate();
    return true;
  };
  return { waiting, absorb };
}
