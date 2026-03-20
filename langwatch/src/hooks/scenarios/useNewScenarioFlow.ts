import { useCallback, useState } from "react";

type UseNewScenarioFlowParams = {
  scenarioCount: number;
  isLoading: boolean;
};

/**
 * Manages the new scenario creation flow, intercepting the action
 * to show a welcome screen when no scenarios exist yet.
 */
export function useNewScenarioFlow({ scenarioCount, isLoading }: UseNewScenarioFlowParams) {
  const [showWelcome, setShowWelcome] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleNewScenario = useCallback(() => {
    if (!isLoading && scenarioCount === 0) {
      setShowWelcome(true);
    } else {
      setShowCreateModal(true);
    }
  }, [scenarioCount, isLoading]);

  const handleWelcomeProceed = useCallback(() => {
    setShowWelcome(false);
    setShowCreateModal(true);
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false);
  }, []);

  return {
    showWelcome,
    showCreateModal,
    handleNewScenario,
    handleWelcomeProceed,
    handleCloseCreateModal,
  };
}
