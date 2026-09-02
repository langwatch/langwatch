/**
 * `useSession`, as the two call sites that survived the move spell it.
 *
 * The identity wire is `better-auth`, it lives in the application, and handing
 * a second client to a feature package would mean a second instance of the same
 * transport over the same cookie. The reader arrives on the host port instead,
 * and the two shapes a call site reads — `data.user` and `status` — are the
 * same ones the application hook returned.
 */

import { useMemo } from "react";

import { useOptionalTraceHost } from "../model/trace-host";

export type TraceSessionReading = {
  data: { user: { id: string; name?: string | null; email?: string | null; image?: string | null } } | null;
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
 *
 * The application hook redirected an unauthenticated reader to the front door.
 * That is landing policy and belongs to whatever serves the address, so it did
 * not travel: on a page served from this package there is already a guard in
 * front, and on the shared-trace page there is deliberately none.
 */
export const useRequiredSession = useSession;
