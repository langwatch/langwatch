/**
 * The public changelog's latest entry and whether this person has opened it.
 * Spec: modules/navigation/specs/whats-new.feature
 */
import type { UserWhatsNewEntry } from "@langwatch/user-contract";
import { useState } from "react";

import { navigationApi } from "./navigation-api.ts";

/** The server reads the changelog once a day; the sidebar asks again at most hourly. */
const STALE_MS = 60 * 60_000;

export function useWhatsNew(): {
  entries: UserWhatsNewEntry[];
  unseen: boolean;
  markSeen: () => void;
} {
  const query = navigationApi.user.whatsNew.useQuery(
    {},
    { staleTime: STALE_MS, retry: false, refetchOnWindowFocus: false },
  );
  const markWhatsNewSeen = navigationApi.user.markWhatsNewSeen.useMutation();
  const [openedId, setOpenedId] = useState<string>();
  const entries = query.data?.entries ?? [];
  const [latest] = entries;

  return {
    entries,
    unseen: latest !== undefined && !latest.seen && openedId !== latest.id,
    markSeen: () => {
      if (!latest || latest.seen || openedId === latest.id) return;
      setOpenedId(latest.id);
      markWhatsNewSeen.mutate({ entryId: latest.id });
    },
  };
}
