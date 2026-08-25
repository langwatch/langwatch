import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ProposalHandlers } from "./components/MessageContent";
import type { LangyContextChip } from "./stores/langyStore";
import type { LangyUiActionHandlers } from "./uiActions/types";

/**
 * Per-page registration surface for Langy (proposal handlers + precise page
 * context). Panel/composer/conversation UI STATE does NOT live here — that is
 * the `useLangyStore` singleton. This context carries only the things a page
 * registers on mount and clears on unmount, so they follow the page.
 */
interface LangyContextValue {
  // A ref, not state: pages re-derive their handlers object on most
  // renders (see useRegisterLangyHandlers), and Langy only ever needs the
  // latest value at proposal-click time, never during render. Storing it
  // as state fed registration straight back into a render loop — register
  // -> setState -> re-render -> new handlers object -> register -> ...
  proposalHandlersRef: RefObject<ProposalHandlers>;
  experimentSlug: string | undefined;
  registerHandlers: (
    handlers: ProposalHandlers,
    opts?: { experimentSlug?: string },
  ) => void;
  clearHandlers: () => void;
  /**
   * Precise page-context chips a page has declared (see
   * `useRegisterLangyPageContext`). Most context is derived from the route by
   * `useLangyPageContext`; this is the escape hatch for context the URL can't
   * express (a selected prompt / dashboard with its human name).
   */
  pageContext: LangyContextChip[];
  registerPageContext: (items: LangyContextChip[]) => void;
  clearPageContext: () => void;
  /**
   * The UI actions the CURRENT page can execute for the agent, kind → handler
   * (specs/langy/langy-ui-actions.feature). A ref for the same reason
   * `proposalHandlersRef` is one: pages re-derive the table on most renders,
   * and the panel only reads it when a `ui` stream entry arrives.
   */
  actionHandlersRef: RefObject<LangyUiActionHandlers>;
  registerActions: (handlers: LangyUiActionHandlers) => void;
  clearActions: () => void;
}

const LangyContext = createContext<LangyContextValue | null>(null);

export function LangyProvider({ children }: { children: ReactNode }) {
  const proposalHandlersRef = useRef<ProposalHandlers>({});
  const actionHandlersRef = useRef<LangyUiActionHandlers>({});
  const [experimentSlug, setExperimentSlug] = useState<string | undefined>();
  const [pageContext, setPageContext] = useState<LangyContextChip[]>([]);

  const registerHandlers = useCallback(
    (handlers: ProposalHandlers, opts?: { experimentSlug?: string }) => {
      proposalHandlersRef.current = handlers;
      setExperimentSlug(opts?.experimentSlug);
    },
    [],
  );

  const clearHandlers = useCallback(() => {
    proposalHandlersRef.current = {};
    setExperimentSlug(undefined);
  }, []);

  const registerActions = useCallback((handlers: LangyUiActionHandlers) => {
    actionHandlersRef.current = handlers;
  }, []);

  const clearActions = useCallback(() => {
    actionHandlersRef.current = {};
  }, []);

  const registerPageContext = useCallback((items: LangyContextChip[]) => {
    setPageContext(items);
  }, []);

  const clearPageContext = useCallback(() => {
    setPageContext([]);
  }, []);

  const value = useMemo<LangyContextValue>(
    () => ({
      proposalHandlersRef,
      experimentSlug,
      registerHandlers,
      clearHandlers,
      pageContext,
      registerPageContext,
      clearPageContext,
      actionHandlersRef,
      registerActions,
      clearActions,
    }),
    [
      experimentSlug,
      registerHandlers,
      clearHandlers,
      pageContext,
      registerPageContext,
      clearPageContext,
      registerActions,
      clearActions,
    ],
  );

  return (
    <LangyContext.Provider value={value}>{children}</LangyContext.Provider>
  );
}

export function useLangy(): LangyContextValue {
  const ctx = useContext(LangyContext);
  if (!ctx) {
    throw new Error("useLangy must be used inside <LangyProvider>");
  }
  return ctx;
}

/**
 * Optional hook for pages that want to expose page-specific proposal
 * handlers (e.g. the experiments workbench). Handlers register on mount
 * and clear on unmount, so other pages get a chat-only Langy.
 */
export function useRegisterLangyHandlers(
  handlers: ProposalHandlers,
  opts?: { experimentSlug?: string },
) {
  const { registerHandlers, clearHandlers } = useLangy();
  const slug = opts?.experimentSlug;
  useEffect(() => {
    registerHandlers(handlers, { experimentSlug: slug });
    return () => clearHandlers();
  }, [handlers, slug, registerHandlers, clearHandlers]);
}

/**
 * Optional hook for pages that expose live UI actions to the agent
 * (specs/langy/langy-ui-actions.feature). Registers on mount, clears on
 * unmount, so navigating away leaves the agent's dispatches unclaimed — which
 * is exactly the signal the server's fallback path keys on.
 */
export function useRegisterLangyActions(handlers: LangyUiActionHandlers) {
  const { registerActions, clearActions } = useLangy();
  useEffect(() => {
    registerActions(handlers);
    return () => clearActions();
  }, [handlers, registerActions, clearActions]);
}

/**
 * Optional hook for pages to declare precise Langy context the route can't
 * express — a selected prompt or dashboard with its human name. Registers on
 * mount, clears on unmount, so the chip follows the page. Route-derivable
 * context (experiment / trace / dataset) needs no call: `useLangyPageContext`
 * reads it from the URL.
 */
export function useRegisterLangyPageContext(items: LangyContextChip[]) {
  const { registerPageContext, clearPageContext } = useLangy();
  // Serialize so a fresh array literal with the same content doesn't re-run.
  const key = JSON.stringify(items);
  useEffect(() => {
    registerPageContext(items);
    return () => clearPageContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, registerPageContext, clearPageContext]);
}
