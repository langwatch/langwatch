import { readSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_ABSENT_REGISTRATIONS,
  LANGY_REGISTRATIONS_SLICE,
  type LangyRegistrationsState,
  type LangyUiActionHandlers,
  type ProposalHandlers,
} from "@langwatch/langy-contract";
import { useEffect } from "react";

/** How this page hands Langy its handlers, read from `langy:registrations`; Langy fills it in. */
const useLangyRegistrations = readSlice<LangyRegistrationsState>({
  name: LANGY_REGISTRATIONS_SLICE,
  absent: LANGY_ABSENT_REGISTRATIONS,
});

/**
 * Optional hook for pages that want to expose page-specific proposal
 * handlers (e.g. the experiments workbench). Handlers register on mount
 * and clear on unmount, so other pages get a chat-only Langy.
 */
export function useRegisterLangyHandlers(
  handlers: ProposalHandlers,
  opts?: { experimentSlug?: string },
) {
  const registerHandlers = useLangyRegistrations((state) => state.registerHandlers);
  const clearHandlers = useLangyRegistrations((state) => state.clearHandlers);
  const slug = opts?.experimentSlug;
  useEffect(() => {
    registerHandlers(handlers, { experimentSlug: slug });
    return () => clearHandlers();
  }, [handlers, slug, registerHandlers, clearHandlers]);
}

/**
 * Optional hook for pages that expose live UI actions to the agent
 * (specs/langy/langy-ui-actions.feature).
 */
export function useRegisterLangyActions(handlers: LangyUiActionHandlers) {
  const registerActions = useLangyRegistrations((state) => state.registerActions);
  const clearActions = useLangyRegistrations((state) => state.clearActions);
  useEffect(() => {
    registerActions(handlers);
    return () => clearActions();
  }, [handlers, registerActions, clearActions]);
}
