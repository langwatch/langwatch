import { useCallback, useState } from "react";

type UseNewScenarioFlowParams = {
  scenarioCount: number;
};

/**
 * Manages the new scenario creation flow, intercepting the action
 * to show a welcome screen when no scenarios exist yet.
 */
export function useNewScenarioFlow({ scenarioCount }: UseNewScenarioFlowParams) {
  const [showWelcome, setShowWelcome] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleNewScenario = useCallback(() => {
    if (scenarioCount === 0) {
      setShowWelcome(true);
    } else {
      setShowCreateModal(true);
    }
  }, [scenarioCount]);

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
