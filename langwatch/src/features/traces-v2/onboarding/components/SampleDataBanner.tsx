import { Button, Flex, Icon, Text } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type React from "react";
import { useLocalStorage } from "usehooks-ts";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useOnboardingStore } from "../store/onboardingStore";

// Match the key used by `useAutoOpenWelcome` so dismissing the sample
// flow also marks What's-new as seen — otherwise the user finishes
// their empty-state tour, clicks Done, and gets *another* tour
// auto-opened immediately. One onboarding moment per visit.
const WELCOME_SEEN_KEY = "langwatch:traces-v2:welcome-seen";

/**
 * Persistent banner across the top of the table while the trace list
 * is rendering `SAMPLE_PREVIEW_TRACES` (i.e. `usePreviewTracesActive`
 * is true). Two jobs:
 *
 *   1. Honesty — the moment the user tries a facet, search, or filter
 *      the substring matcher in `filterPreviewTraces` will frequently
 *      return zero rows (e.g. a service facet for "production-api"
 *      doesn't substring-match the fixture services). Without the
 *      banner that reads as a broken product. With it, the user knows
 *      "ah, sample data, my real facets will fire when traces land."
 *
 *   2. Exit — gives the user an explicit "drop me into the real
 *      (empty) table" affordance. Click flips the per-project
 *      `setupDismissedByProject` flag, which gates `previewActive`
 *      off; the underlying tRPC list query enables and fetches
 *      against the real backend; the user lands in the clean
 *      post-tour state. We invalidate the list cache on the way out
 *      so the first real fetch isn't accidentally satisfied by any
 *      pre-flight cached entries from a prior visit.
 *
 * Visible only when preview is active — once dismissed, this whole
 * pane unmounts and the banner with it.
 */
export const SampleDataBanner: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const setSetupDismissedForProject = useOnboardingStore(
    (s) => s.setSetupDismissedForProject,
  );
  const utils = api.useUtils();
  const setTourActive = useOnboardingStore((s) => s.setTourActive);
  const [, setWelcomeSeen] = useLocalStorage<boolean>(
    WELCOME_SEEN_KEY,
    false,
  );

  const handleDone = () => {
    if (!project) return;
    setSetupDismissedForProject(project.id, true);
    // Also clear the tour-active override (set by the toolbar's Tour
    // button for existing customers re-entering the demo). Without
    // this, the empty state would re-mount on next render because
    // `tourActive=true` keeps `showEmptyState` true regardless of
    // dismissal.
    setTourActive(false);
    setWelcomeSeen(true);
    void utils.tracesV2.list.invalidate({ projectId: project.id });
  };

  return (
    <Flex
      align="center"
      gap={2}
      paddingX={3}
      paddingY={1.5}
      background="orange.subtle"
      borderBottomWidth="1px"
      borderColor="orange.muted"
      color="orange.fg"
      flexShrink={0}
    >
      <Icon boxSize={3.5}>
        <Sparkles />
      </Icon>
      <Text textStyle="xs" fontWeight={500}>
        Sample data — facets, filters, the drawer all work. Nothing here
        is real until you connect your SDK.
      </Text>
      <Button
        size="xs"
        variant="ghost"
        colorPalette="orange"
        marginLeft="auto"
        onClick={handleDone}
        disabled={!project}
      >
        Done exploring →
      </Button>
    </Flex>
  );
};
