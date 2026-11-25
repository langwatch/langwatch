/**
 * Reports a failure to the host, which resolves the words from the error's
 * code; the screen never composes a sentence over a code.
 */

import { useCallback } from "react";

import { useAnnotationHost } from "../model/annotation-host.ts";

export function useShowErrorToast() {
  const host = useAnnotationHost();

  return useCallback(
    ({ error, fallbackTitle }: { error: unknown; fallbackTitle: string }) => {
      host.failed({ error, fallbackTitle });
    },
    [host],
  );
}
