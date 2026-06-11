import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ProposalHandlers } from "./MessageContent";

interface LangyContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  proposalHandlers: ProposalHandlers;
  experimentSlug: string | undefined;
  registerHandlers: (
    handlers: ProposalHandlers,
    opts?: { experimentSlug?: string },
  ) => void;
  clearHandlers: () => void;
}

const LangyContext = createContext<LangyContextValue | null>(null);

export function LangyProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [proposalHandlers, setProposalHandlers] = useState<ProposalHandlers>(
    {},
  );
  const [experimentSlug, setExperimentSlug] = useState<string | undefined>();

  const registerHandlers = useCallback(
    (handlers: ProposalHandlers, opts?: { experimentSlug?: string }) => {
      setProposalHandlers(handlers);
      setExperimentSlug(opts?.experimentSlug);
    },
    [],
  );

  const clearHandlers = useCallback(() => {
    setProposalHandlers({});
    setExperimentSlug(undefined);
  }, []);

  const value = useMemo<LangyContextValue>(
    () => ({
      isOpen,
      setIsOpen,
      proposalHandlers,
      experimentSlug,
      registerHandlers,
      clearHandlers,
    }),
    [
      isOpen,
      proposalHandlers,
      experimentSlug,
      registerHandlers,
      clearHandlers,
    ],
  );

  return <LangyContext.Provider value={value}>{children}</LangyContext.Provider>;
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
