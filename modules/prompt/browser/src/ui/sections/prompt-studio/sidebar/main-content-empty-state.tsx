import { useAllPromptsForProject } from "../../../../behavior/use-all-prompts-for-project.ts";
import { NoPromptsOnboardingState } from "./no-prompts-onboarding-state.tsx";
import { NoTabsOpenState } from "./no-tabs-open-state.tsx";

/**
 * Empty state component for the main content area when no tabs are open.
 * Single Responsibility: Route to appropriate empty state based on whether prompts exist.
 */
export function MainContentEmptyState() {
  const { data } = useAllPromptsForProject();
  const publishedPrompts = data?.filter((prompt) => prompt.version > 0);
  const hasNoPrompts = publishedPrompts?.length === 0;

  if (hasNoPrompts) {
    return <NoPromptsOnboardingState />;
  }

  return <NoTabsOpenState />;
}
