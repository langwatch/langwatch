import { useCallback, useState } from "react";

const welcomeSeenKey = "langwatch:scenarios:welcomeSeen";

function getWelcomeSeen(): boolean {
  try {
    return localStorage.getItem(welcomeSeenKey) === "true";
  } catch {
    return false;
  }
}

function setWelcomeSeen(): void {
  try {
    localStorage.setItem(welcomeSeenKey, "true");
  } catch {
    // localStorage is unavailable in a private browsing context.
  }
}

export function useNewScenarioFlow({
  scenarioCount,
  isLoading,
}: {
  scenarioCount: number;
  isLoading: boolean;
}) {
  const [welcomeDismissed, setWelcomeDismissed] = useState(getWelcomeSeen);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const showInlineWelcome = !isLoading && scenarioCount === 0 && !welcomeDismissed;

  const dismissWelcome = useCallback(() => {
    setWelcomeSeen();
    setWelcomeDismissed(true);
  }, []);

  const handleNewScenario = useCallback(() => {
    if (!welcomeDismissed && !isLoading && scenarioCount === 0) {
      setShowWelcomeModal(true);
      return;
    }
    setShowCreateModal(true);
  }, [welcomeDismissed, isLoading, scenarioCount]);

  const handleWelcomeProceed = useCallback(() => {
    dismissWelcome();
    setShowWelcomeModal(false);
    setShowCreateModal(true);
  }, [dismissWelcome]);

  const handleWelcomeModalOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        dismissWelcome();
        setShowWelcomeModal(false);
      }
    },
    [dismissWelcome],
  );

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
