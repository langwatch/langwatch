/**
 * Publishes the mounted host as the feedback sink the toast singleton reports to.
 *
 * `toaster` and `showErrorToast` are module-scope calls rather than hooks —
 * most of them fire from a mutation callback where no hook can run — so the
 * host has to reach them some other way. The studio screen calls this once, at
 * the top of the tree everything else renders under.
 */

import { currentUiFeedbackHost, setUiFeedbackHost } from "@langwatch/ui-host/toaster";
import { useEffect } from "react";

import { useWorkflowHost } from "../../../model/workflow-host";

export function useStudioHostBinding(): void {
  const host = useWorkflowHost();

  // Set during render as well as in the effect: a toast raised by a query that
  // resolves before the first effect runs would otherwise be dropped.
  setUiFeedbackHost(host);

  // Restores whatever was registered before this mount rather than clearing:
  // the application shell registers its own port, and a studio unmount must
  // not leave the rest of the product with no way to report a failure.
  useEffect(() => {
    const previous = currentUiFeedbackHost();
    setUiFeedbackHost(host);
    return () => setUiFeedbackHost(previous);
  }, [host]);
}
