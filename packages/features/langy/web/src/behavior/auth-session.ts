/**
 * `useSession`, as the one call site that survived the move spells it.
 */

import { useMemo } from "react";

import { useOptionalLangyHost } from "../model/langy-host";

export type LangySessionReading = {
  data: {
    user: { id: string; name?: string | null; email?: string | null; image?: string | null };
  } | null;
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
