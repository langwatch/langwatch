/**
 * `useSession`, as the two call sites that survived the move spell it.
 */

import { useMemo } from "react";

import { useOptionalTraceHost } from "./trace-host";

export type TraceSessionReading = {
  data: {
    user: { id: string; name?: string | null; email?: string | null; image?: string | null };
  } | null;
  status: "authenticated" | "unauthenticated" | "loading";
  isPending: false;
};

export function useSession(_options?: {
  required?: boolean;
  onUnauthenticated?: () => void;
}): TraceSessionReading {
  const host = useOptionalTraceHost();
  const user = host?.currentUser();
  return useMemo(
    () =>
      user
        ? { data: { user }, status: "authenticated" as const, isPending: false as const }
        : { data: null, status: "unauthenticated" as const, isPending: false as const },
    [user],
  );
}

/**
 * The session, where a caller used to demand one.
 */
export const useRequiredSession = useSession;
