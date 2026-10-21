import { useEffect } from "react";

import { api } from "./personal-workspace-api.ts";

type Page = "me_sessions";
type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Sends the page-opened mutation at most once an hour per page from this tab's storage, so a
 * refresh does not write an event; nurturing's claim stays the authority across devices. Storage
 * that throws or a send that fails never reaches the page.
 */
export async function recordPageOpenedOncePerHour({
  page,
  storage,
  now,
  send,
}: {
  page: Page;
  storage: KeyValueStorage;
  now: () => number;
  send: (page: Page) => Promise<unknown>;
}): Promise<void> {
  const key = `langwatch:page-opened:${page}`;
  try {
    const last = Number(storage.getItem(key));
    if (Number.isFinite(last) && last > 0 && now() - last < HOUR_MS) return;
    storage.setItem(key, String(now()));
  } catch {
    // Blocked storage only costs the throttle.
  }
  try {
    await send(page);
  } catch {
    // Announcing an open is best effort.
  }
}

/** Announces once per mount that the person opened this page. */
export function useRecordPageOpened({ page }: { page: Page }): void {
  const { mutateAsync } = api.auth.recordPageOpened.useMutation();

  useEffect(() => {
    void recordPageOpenedOncePerHour({
      page,
      // Read lazily: touching `sessionStorage` itself throws where storage is blocked.
      storage: {
        getItem: (key) => window.sessionStorage.getItem(key),
        setItem: (key, value) => window.sessionStorage.setItem(key, value),
      },
      now: Date.now,
      send: (opened) => mutateAsync({ page: opened }),
    });
  }, [page, mutateAsync]);
}
