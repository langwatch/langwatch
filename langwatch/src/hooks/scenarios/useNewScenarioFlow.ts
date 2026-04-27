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
 * Manages the new scenario creation flow with two welcome surfaces:
 *
 * 1. **Inline welcome** (`showInlineWelcome`) — auto-shown in the page when
 *    there are zero scenarios and the user hasn't dismissed it yet.
 * 2. **Welcome modal** (`showWelcomeModal`) — shown when the user clicks
 *    "New Scenario" and hasn't completed the welcome onboarding yet.
 *
 * Once the user proceeds from either surface, `welcomeSeen` is persisted in
 * localStorage and neither surface appears again.
 */
export function useNewScenarioFlow({ scenarioCount, isLoading }: UseNewScenarioFlowParams) {
  const [welcomeDismissed, setWelcomeDismissed] = useState(getWelcomeSeen);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Inline welcome is visible when: no scenarios, not loading, not yet dismissed
  const showInlineWelcome = !isLoading && scenarioCount === 0 && !welcomeDismissed;

  const dismissWelcome = useCallback(() => {
    setWelcomeSeen();
    setWelcomeDismissed(true);
  }, []);

  const handleNewScenario = useCallback(() => {
    if (!welcomeDismissed && !isLoading && scenarioCount === 0) {
      setShowWelcomeModal(true);
    } else {
      setShowCreateModal(true);
    }
  }, [welcomeDismissed, isLoading, scenarioCount]);

  const handleWelcomeProceed = useCallback(() => {
    dismissWelcome();
    setShowWelcomeModal(false);
    setShowCreateModal(true);
  }, [dismissWelcome]);

  const handleWelcomeModalOpenChange = useCallback((open: boolean) => {
    if (!open) {
      dismissWelcome();
      setShowWelcomeModal(false);
    }
  }, [dismissWelcome]);

  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false);
  }, []);

  return {
    showInlineWelcome,
    showWelcomeModal,
    showCreateModal,
    handleNewScenario,
    handleWelcomeProceed,
    handleWelcomeModalOpenChange,
    handleCloseCreateModal,
  };
}
