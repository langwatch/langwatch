/**
 * A failure notice, raised with the words the error itself carries.
 *
 * `platform/app`'s `showErrorToast` is a module-scope call that resolves copy
 * from that application's code-keyed presentation registry. A feature package
 * may not reach the registry, and it must not compose a sentence over a code —
 * the wire message of a handled error IS its code slug since #5984 — so the raw
 * error travels to the host and the application decides the words.
 *
 * A HOOK RATHER THAN A SINGLETON because every call site here is inside the
 * component: the two mutations that report through it are declared in the
 * screen's own body, so there is a host in scope and no module-level binding is
 * needed.
 */

import { useCallback } from "react";

import { useAnnotationHost } from "../model/annotation-host";

export function useShowErrorToast() {
  const host = useAnnotationHost();
  return useCallback(
    ({ error, fallbackTitle }: { error: unknown; fallbackTitle: string }) => {
      host.failed({ error, fallbackTitle });
    },
    [host],
  );
}
