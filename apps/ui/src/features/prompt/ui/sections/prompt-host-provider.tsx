/**
 * What Prompt Studio is mounted inside.
 *
 * Two things go around `/:project/prompts`: the tRPC Provider the package's own
 * hooks run on, and the host port that answers for the project, the reader's
 * grants, the replication targets, the address, the feedback, the browser
 * storage the open tabs live in and the upgrade prompt. Both are mounted here,
 * once, so a screen module stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads the whole graph rather than one project, because
 * the replication picker offers every project the reader may create a prompt
 * in — and because the project's API key, which the chat run and the deploy
 * snippets send, is a column on it.
 */

import { promptApi, PromptHostProvider } from "@langwatch/prompt-web/screens/prompt-studio";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { browserUiLogger, browserUiStorage } from "../../../../behavior/ui-browser-storage";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiPromptHost, type PromptTabCapabilities } from "../../behavior/prompt-host.adapter";
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

function PromptHost({ children }: { children: ReactNode }) {
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
  const host = useMemo(
    () =>
      UiPromptHost.create(
        {
          scope: {
            organizationId: scope.organizationId ?? void 0,
            teamId: project?.teamId,
            projectId: project?.id,
            projectSlug: project?.slug,
            projectApiKey: project?.apiKey,
          },
          hasPermission: (permission: string) => session.hasPermission(permission),
          copyTargets,
          route: reading,
          tabCapabilities,
          playgroundChat,
        },
        {
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
          /**
           * `platform/app` opened its own upgrade modal from a module-level
           * store. Nothing above a screen served from `apps/ui` holds one, so
           * the reader is sent to the plan settings instead — the same place
           * that modal's own call to action leads.
           */
          requestUpgrade: () => navigation.navigate("/settings/subscription"),
        },
      ),
    [scope.organizationId, project, session, copyTargets, reading, route, navigation, feedback],
  );

  return <PromptHostProvider value={host}>{children}</PromptHostProvider>;
}

/** Wraps the Prompt Studio screen in the host its package asks for. */
export function withPromptHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <PromptHost>
      <Screen {...props} />
    </PromptHost>
  );
  Mounted.displayName = `withPromptHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
