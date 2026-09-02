/**
 * `useSession`, as the one call site that survived the move spells it.
 *
 * The identity wire is `better-auth`, it lives in the application, and handing
 * a second client to a feature package would mean a second instance of the same
 * transport over the same cookie. The reader arrives on the host port instead,
 * and the two shapes the call site reads — `data.user` and `status` — are the
 * same ones the application hook returned.
 *
 * The application hook redirected an unauthenticated reader to the front door.
 * That is landing policy and belongs to whatever serves the address: the dock
 * only ever renders behind a guard that has already answered the question.
 */

import { useMemo } from "react";

import { useOptionalLangyHost } from "../model/langy-host";

export type LangySessionReading = {
  data: { user: { id: string; name?: string | null; email?: string | null; image?: string | null } } | null;
  status: "authenticated" | "unauthenticated" | "loading";
  isPending: false;
};

export function useSession(_options?: {
  required?: boolean;
  onUnauthenticated?: () => void;
}): LangySessionReading {
  const host = useOptionalLangyHost();
  const user = host?.currentUser();
  return useMemo(
    () =>
      user
        ? { data: { user }, status: "authenticated" as const, isPending: false as const }
        : { data: null, status: "unauthenticated" as const, isPending: false as const },
    [user],
  );
}

export const useRequiredSession = useSession;
