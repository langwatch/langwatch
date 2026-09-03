/**
 * What Prompt Studio is mounted inside.
 *
 * Two things go around `/:project/prompts`: the tRPC Provider the package's own
 * hooks run on, and the host port that answers for the project, the reader's
 * grants, the replication targets, the address, the feedback, the browser
 * storage the open tabs live in and the upgrade prompt. Both are mounted here,
 * once, so a screen module stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads the whole graph rather than one project, because
 * the replication picker offers every project the reader may create a prompt
 * in — and because the project's API key, which the chat run and the deploy
 * snippets send, is a column on it.
 *
 * `isReportedGlobally` IS A RECORDED GAP RATHER THAN A CARRIED BEHAVIOUR, and
 * the honest answer here is `false`. `platform/app` dedupes a refusal that one
 * of its four global interceptors already rendered as a modal — the plan limit,
 * the lite-member restriction — and the prompt row actions asked before
 * toasting so a reader was not told the same thing twice. That answer is a
 * `WeakSet` those interceptors write to, and the interceptors live on
 * `platform/app`'s own MutationCache (`utils/api.tsx`), which does NOT wrap the
 * client `apps/ui` builds. Nothing reaching this screen has been through them,
 * so nothing has been reported twice; the screen's own notice is the only one.
 */

import { promptApi, PromptHostProvider, type PromptHostPort } from "@langwatch/prompt-web/screens/prompt-studio";
import { useMemo, type ReactNode } from "react";
import { browserUiLogger, browserUiStorage } from "../../../../behavior/ui-browser-storage";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { resolvePromptDrawerAddress } from "../../behavior/prompt-drawer-address";
import type { PromptTabCapabilities } from "../../behavior/prompt-tab-capabilities";
import { promptCopyTargets } from "../../model/prompt-copy-targets";
import { promptPlaygroundChatAvailability } from "../../model/prompt-playground-chat-availability";

/**
 * The browser services the packaged tab store runs on.
 *
 * Both come from the global layer rather than being reached for here: a
 * frontend feature may not name a browser global, which is what
 * `ui-browser-capability` enforces and what keeps a feature mountable
 * elsewhere. `behavior/ui-browser-storage.ts` is where the application answers
 * for the two, beside the selection memory it already keeps there.
 */
const tabCapabilities: PromptTabCapabilities = {
  storage: browserUiStorage,
  logger: browserUiLogger,
};

/**
 * The chat runtime this application serves, which is none.
 *
 * Resolved once at module scope because it is a property of the composition
 * rather than of the reader, the project or the address — see
 * `model/prompt-playground-chat-availability` for why the answer is what it is.
 */
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
      // See the file docblock: nothing above a package-served screen has
      // reported a failure yet, so the answer is always no.
      isReportedGlobally: () => false,
      copyTargets: () => copyTargets,
      tabCapabilities: () => tabCapabilities,
      playgroundChat: () => playgroundChat,
      /**
       * `platform/app` opened its own upgrade modal from a module-level
       * store. Nothing above a screen served from `apps/ui` holds one, so
       * the reader is sent to the plan settings instead — the same place
       * that modal's own call to action leads.
       */
      requestUpgrade: () => navigation.navigate("/settings/subscription"),
      openPlatformDrawer: (request) =>
        route.setQuery(resolvePromptDrawerAddress({ query: reading.query, ...request })),
    }),
    [scope.organizationId, project, session, copyTargets, reading, route, navigation, feedback],
  );

  return <PromptHostProvider value={host}>{children}</PromptHostProvider>;
}
