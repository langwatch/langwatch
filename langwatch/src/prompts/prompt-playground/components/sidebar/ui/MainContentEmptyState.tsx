import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { NoPromptsOnboardingState } from "./NoPromptsOnboardingState";
import { NoTabsOpenState } from "./NoTabsOpenState";

/**
 * Empty state component for the main content area when no tabs are open.
 * Single Responsibility: Route to appropriate empty state based on whether prompts exist.
 */
export function MainContentEmptyState() {
  const { data } = useAllPromptsForProject();
  const publishedPrompts = data?.filter((prompt) => prompt.version > 0);
  const hasNoPrompts = !publishedPrompts || publishedPrompts.length === 0;

  if (hasNoPrompts) {
    return <NoPromptsOnboardingState />;
  }

  return <NoTabsOpenState />;
}

