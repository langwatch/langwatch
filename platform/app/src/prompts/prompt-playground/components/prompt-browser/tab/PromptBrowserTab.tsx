import { PromptBrowserTab as PromptBrowserTabView } from "@langwatch/prompt-web/screens/prompt-studio";
import { usePromptBrowserTabController } from "./usePromptBrowserTabController";

interface PromptBrowserTabProps {
  dimmed?: boolean;
  isActive?: boolean;
  isCrowded?: boolean;
}

/** App adapter for the browser-safe Prompt tab presentation. */
export function PromptBrowserTab(props: PromptBrowserTabProps) {
  const {
    tab,
    title,
    hasUnsavedChanges,
    handleClose,
    versionNumber,
    latestVersion,
    isOutdated,
    handleUpgrade,
    showVersionBadge,
  } = usePromptBrowserTabController();

  if (!tab) return null;

  return (
    <PromptBrowserTabView
      {...props}
      title={title}
      hasUnsavedChanges={hasUnsavedChanges}
      versionNumber={versionNumber}
      latestVersion={latestVersion}
      isOutdated={isOutdated}
      showVersionBadge={showVersionBadge}
      onClose={handleClose}
      onUpgrade={handleUpgrade}
    />
  );
}
