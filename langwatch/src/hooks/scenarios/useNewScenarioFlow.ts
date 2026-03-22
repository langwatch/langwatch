import { useCallback, useState } from "react";

const WELCOME_SEEN_KEY = "langwatch:scenarios:welcomeSeen";

type UseNewScenarioFlowParams = {
  scenarioCount: number;
  isLoading: boolean;
};

function getWelcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

function setWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, "true");
  } catch {
    // localStorage may be unavailable (e.g. private browsing)
  }
}

/**
 * Manages the new scenario creation flow, intercepting the action
 * to show a welcome modal when no scenarios exist yet and the user
 * has not previously seen the welcome screen.
 *
 * Welcome-seen state is persisted in localStorage so the modal
 * is only shown once per user.
 */
export function useNewScenarioFlow({ scenarioCount, isLoading }: UseNewScenarioFlowParams) {
  const [showWelcome, setShowWelcome] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleNewScenario = useCallback(() => {
    if (!isLoading && scenarioCount === 0 && !getWelcomeSeen()) {
      setShowWelcome(true);
    } else {
      setShowCreateModal(true);
    }
  }, [scenarioCount, isLoading]);

  const handleWelcomeProceed = useCallback(() => {
    setWelcomeSeen();
    setShowWelcome(false);
    setShowCreateModal(true);
  }, []);

  const handleWelcomeOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setShowWelcome(false);
    }
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false);
  }, []);

  return {
    showWelcome,
    showCreateModal,
    handleNewScenario,
    handleWelcomeProceed,
    handleWelcomeOpenChange,
    handleCloseCreateModal,
  };
}
