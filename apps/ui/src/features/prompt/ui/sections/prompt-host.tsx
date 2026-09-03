/**
 * What Prompt Studio is mounted inside: the tRPC Provider its hooks run on,
 * and the host port for project, grants, replication targets, address,
 * feedback, tab storage and the upgrade prompt.
 */

import {
  promptApi,
  PromptHostProvider,
  type PromptHostPort,
} from "@langwatch/prompt-web/screens/prompt-studio";
import { useMemo, type ReactNode } from "react";
import { browserUiLogger, browserUiStorage } from "../../../../behavior/ui-browser-storage";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { resolvePromptDrawerAddress } from "../../behavior/prompt-drawer-address";
import type { PromptTabCapabilities } from "../../behavior/prompt-tab-capabilities";
import { promptCopyTargets } from "../../model/prompt-copy-targets";
import { promptPlaygroundChatAvailability } from "../../model/prompt-playground-chat-availability";

/** The browser services the packaged tab store runs on — a feature may not name a browser global, so these come from the global layer. */
const tabCapabilities: PromptTabCapabilities = {
  storage: browserUiStorage,
  logger: browserUiLogger,
};

/** The chat runtime this application serves (none), resolved once at module scope — a property of the composition, not the reader or address. */
const playgroundChat = promptPlaygroundChatAvailability();

export function PromptHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = promptApi.organization.getAll.useQuery({ isDemo: false });

  /**
   * The project the address is about, resolved from the one graph read rather
   * than from a second query. Without a project in scope the screen renders its
   * empty shell, which is what it did before: every prompt belongs to a project.
   */
  const project = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) return { ...found, teamId: team.id };
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  const copyTargets = useMemo(
    () =>
      promptCopyTargets({
        organizations: organizations.data ?? [],
        userId: session.currentUser()?.id,
      }),
    [organizations.data, session],
  );

  const reading = route.reading();
  const host = useMemo<PromptHostPort>(
    () => ({
      scope: () => ({
        organizationId: scope.organizationId ?? void 0,
        teamId: project?.teamId,
        projectId: project?.id,
        projectSlug: project?.slug,
        projectApiKey: project?.apiKey,
      }),
      hasPermission: (permission) => session.hasPermission(permission),
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
      // Recorded gap: platform/app's dedup WeakSet lives on its own
      // MutationCache, which doesn't wrap this application's client.
      isReportedGlobally: () => false,
      copyTargets: () => copyTargets,
      tabCapabilities: () => tabCapabilities,
      playgroundChat: () => playgroundChat,
      // No upgrade modal above this screen, so send the reader to plan
      // settings directly — the same place that modal's own CTA leads.
      requestUpgrade: () => navigation.navigate("/settings/subscription"),
      openPlatformDrawer: (request) =>
        route.setQuery(resolvePromptDrawerAddress({ query: reading.query, ...request })),
    }),
    [scope.organizationId, project, session, copyTargets, reading, route, navigation, feedback],
  );

  return <PromptHostProvider value={host}>{children}</PromptHostProvider>;
}
