import { useEffect } from "react";

import { useExplorerLangyActions } from "../../../../behavior/langy/use-explorer-langy-actions.ts";
import { useOptionalTraceHost } from "../../../../behavior/trace-host.ts";

/**
 * Publishes the Explorer's actions for as long as the page is open, through
 * the host the application mounted — the page never reaches the agent itself.
 * @see specs/langy/langy-trace-explorer-actions.feature
 */
export const ExplorerLangyActions: React.FC = () => {
  const host = useOptionalTraceHost();
  const handlers = useExplorerLangyActions();

  useEffect(() => host?.registerLangyActions(handlers), [host, handlers]);

  return null;
};
