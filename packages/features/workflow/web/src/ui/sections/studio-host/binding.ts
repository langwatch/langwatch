/**
 * Publishes the mounted host to the studio's two singletons.
 *
 * `toaster` and `showErrorToast` are module-scope calls rather than hooks —
 * most of them fire from a mutation callback where no hook can run — so the
 * host has to reach them some other way. The studio screen calls this once, at
 * the top of the tree everything else renders under, and both singletons then
 * answer for the life of the mount.
 */

import { useEffect } from "react";

import { useWorkflowHost } from "../../../model/workflow-host";
import { setStudioErrorHost } from "../../elements/studio-host/errors";
import { setStudioFeedbackHost } from "../../../behavior/studio-host/toaster";

export function useStudioHostBinding(): void {
  const host = useWorkflowHost();

  // Set during render as well as in the effect: a toast raised by a query that
  // resolves before the first effect runs would otherwise be dropped.
  setStudioFeedbackHost(host);
  setStudioErrorHost(host);

  useEffect(() => {
    setStudioFeedbackHost(host);
    setStudioErrorHost(host);
    return () => {
      setStudioFeedbackHost(void 0);
      setStudioErrorHost(void 0);
    };
  }, [host]);
}
