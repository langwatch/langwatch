import { Spacer } from "@chakra-ui/react";
import type { AgentWithFields } from "@langwatch/agent-contract";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Plus } from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";
import { agentApi } from "../../behavior/agent-api";
import { getAgentEditorDrawer } from "../../features/editor/model/get-agent-editor-drawer";
import {
  AgentTypeSelectorDrawer,
  type AgentType,
} from "../../features/editor/ui/sections/agent-type-selector-drawer";
import { AgentHistoryDrawer } from "../../features/history/ui/sections/agent-history-drawer";
import { AgentArchiveDialog } from "../../features/management/ui/blocks/agent-archive-dialog";
import { AgentPushDialog } from "../../features/management/ui/blocks/agent-push-dialog";
import { AgentReplicateDialog } from "../../features/management/ui/blocks/agent-replicate-dialog";
import { AgentCard } from "../../features/management/ui/blocks/agent-card";
import {
  AgentManagementCardPort,
  AgentManagementFeedbackPort,
  AgentManagementLifecyclePort,
  AgentManagementNavigationPort,
  AgentManagementPage,
  AgentPageCompositionPort,
  type AgentArchiveDialogInput,
  type AgentCardRenderInput,
  type AgentCopyDialogInput,
  type AgentPushDialogInput,
} from "../../features/management/ui/sections/agent-management-page";
import { formatTimeAgo } from "../../model/format-time-ago";
import {
  useAgentManagementHost,
  type AgentManagementHostPort,
} from "../../model/agent-management-host";

/**
 * The Agents page, as `/:project/agents` serves it.
 *
 * What used to be `platform/app/src/runtime/ui/features/agent-ui-host.adapter.tsx`
 * — three hundred and forty-seven lines that were entirely adapter: a browser
 * transport, four generic dialogs, a card wrapper and the four navigations the
 * list offers. The list itself has always been this package's. The adapter's
 * halves split along the line ADR-004 draws: the application-shaped half is the
 * host port `apps/ui` answers, and everything below is here.
 *
 * TWO OVERLAYS ARE THIS SCREEN'S OWN, addressed by query keys it names itself —
 * `?history=<agentId>` and `?new=agent`. That is the shape the gateway family
 * established and every family since has copied: the application's drawer
 * registry is a composition a feature-web package may not carry, and a screen
 * only ever needed the address. The platform registry's `agentHistory` entry is
 * deleted with the adapter, because this screen was its only opener.
 *
 * THE THREE EDITORS ARE NOT. `agentCodeEditor`, `agentHttpEditor` and
 * `agentWorkflowEditor` stay registered in `platform/app` for the scenario
 * editor, the experiments workbench, the agent-testing dialog and the Agent list
 * drawer, all of which still open them; their closures reach the optimization
 * studio and the application's own variables surface. So this screen names the
 * drawer and the application writes the address the rest of the product already
 * produces for an agent — the same `?drawer.open=…&drawer.agentId=…` that
 * `agent-platform-url.ts` and Langy's deep links emit. KNOWN GAP, recorded in
 * `dev/docs/plans/ui-family-move-manifests.md` and shared with every family
 * before this one: nothing mounts that registry above a screen served from
 * `apps/ui` until the chrome layout route exists, so the address is right and
 * the drawer does not open yet.
 */

/** The query key the history overlay is addressed by. */
export const AGENT_HISTORY_QUERY_KEY = "history";

/** The query key the type selector is addressed by. */
export const AGENT_NEW_QUERY_KEY = "new";

/** The value `?new=` carries; a name rather than a flag, so it reads in a URL. */
export const AGENT_NEW_QUERY_VALUE = "agent";

class ScreenComposition extends AgentPageCompositionPort {
  constructor(private readonly host: AgentManagementHostPort) {
    super();
  }

  renderHeader({ onCreate }: { onCreate: () => void }): ReactNode {
    return (
      <PageLayout.Header>
        <PageLayout.Heading>Agents</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton onClick={onCreate}>
          <Plus size={16} /> New Agent
        </PageLayout.HeaderButton>
      </PageLayout.Header>
    );
  }

  renderArchiveDialog(input: AgentArchiveDialogInput): ReactNode {
    return (
      <AgentArchiveDialog
        open={input.open}
        agentName={input.agentName}
        relatedWorkflow={input.relatedEntities?.workflow ?? null}
        isLoading={input.isLoading}
        isLoadingRelated={input.isLoadingRelated}
        onClose={input.onClose}
        onConfirm={input.onConfirm}
      />
    );
  }

  renderCopyDialog(input: AgentCopyDialogInput): ReactNode {
    return (
      <AgentReplicateDialog
        open={input.open}
        agentName={input.agentName}
        projects={input.projects}
        isLoading={input.isLoading}
        onClose={input.onClose}
        onCopy={async (projectId) => {
          try {
            await input.onCopy(projectId);
            this.host.succeeded({
              title: "Agent replicated",
              description: `Agent "${input.agentName}" replicated successfully.`,
            });
          } catch (error) {
            this.host.failed({ error, fallbackTitle: "Couldn't replicate the agent" });
          }
        }}
      />
    );
  }

  renderPushDialog(input: AgentPushDialogInput): ReactNode {
    return (
      <AgentPushDialog
        open={input.open}
        agentName={input.agentName}
        copies={input.copies}
        isLoading={input.isLoading}
        {...(input.error
          ? {
              errorMessage: this.host.describeFailure({
                error: input.error,
                fallbackTitle: "Couldn't load replicas",
              }),
            }
          : {})}
        selectedCopyIds={input.selectedCopyIds}
        isPushing={input.isPushing}
        onClose={input.onClose}
        onToggleCopy={input.onToggleCopy}
        onPush={async () => {
          try {
            const result = await input.onPush();
            this.host.succeeded({
              title: "Agent pushed",
              description: `"${input.agentName}" has been pushed to ${result.pushedTo} of ${result.selectedCopies} selected replicated agent(s).`,
            });
          } catch (error) {
            this.host.failed({ error, fallbackTitle: "Couldn't push the agent" });
          }
        }}
      />
    );
  }
}

class ScreenCard extends AgentManagementCardPort {
  render({ agent, ...callbacks }: AgentCardRenderInput): ReactNode {
    return (
      <AgentCard
        agent={agent}
        updatedAtLabel={formatTimeAgo(agent.updatedAt.getTime())}
        {...callbacks}
      />
    );
  }
}

const screenCard = new ScreenCard();

class ScreenNavigation extends AgentManagementNavigationPort {
  constructor(
    private readonly navigation: {
      openEditor: (agent: AgentWithFields) => void;
      openTypeSelector: () => void;
      openHistory: (agent: AgentWithFields) => void;
      openWorkflow: (agent: AgentWithFields) => void;
    },
  ) {
    super();
  }

  openEditor(agent: AgentWithFields): void {
    this.navigation.openEditor(agent);
  }

  openTypeSelector(): void {
    this.navigation.openTypeSelector();
  }

  openHistory(agent: AgentWithFields): void {
    this.navigation.openHistory(agent);
  }

  openWorkflow(agent: AgentWithFields): void {
    this.navigation.openWorkflow(agent);
  }
}

class ScreenFeedback extends AgentManagementFeedbackPort {
  constructor(private readonly host: AgentManagementHostPort) {
    super();
  }

  showSuccess(input: { title: string; description?: string }): void {
    this.host.succeeded(input);
  }

  showError(input: { error: unknown; fallbackTitle: string }): void {
    this.host.failed(input);
  }
}

class ScreenLifecycle extends AgentManagementLifecyclePort {
  constructor(
    private readonly lifecycle: {
      agentsChanged: () => Promise<void>;
      agentArchived: () => Promise<void>;
    },
  ) {
    super();
  }

  agentsChanged(): Promise<void> {
    return this.lifecycle.agentsChanged();
  }

  agentArchived(): Promise<void> {
    return this.lifecycle.agentArchived();
  }
}

export function AgentManagementScreen() {
  const host = useAgentManagementHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const utils = agentApi.useUtils();
  const agents = host.agents();

  const agentsQuery = agentApi.agents.getAll.useQuery({ projectId }, { enabled: Boolean(project) });

  const items = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const reading = host.route();
  const historyAgentId = reading.query[AGENT_HISTORY_QUERY_KEY];
  const isCreating = reading.query[AGENT_NEW_QUERY_KEY] === AGENT_NEW_QUERY_VALUE;

  const openEditor = useCallback(
    (agent: AgentWithFields) => {
      host.openAgentEditor({ drawer: getAgentEditorDrawer(agent.type), agentId: agent.id });
    },
    [host],
  );
  const openTypeSelector = useCallback(() => {
    host.setQuery({ ...reading.query, [AGENT_NEW_QUERY_KEY]: AGENT_NEW_QUERY_VALUE });
  }, [host, reading.query]);
  const closeTypeSelector = useCallback(() => {
    host.setQuery({ ...reading.query, [AGENT_NEW_QUERY_KEY]: void 0 });
  }, [host, reading.query]);
  const openHistory = useCallback(
    (agent: AgentWithFields) => {
      host.setQuery({ ...reading.query, [AGENT_HISTORY_QUERY_KEY]: agent.id });
    },
    [host, reading.query],
  );
  const closeHistory = useCallback(() => {
    host.setQuery({ ...reading.query, [AGENT_HISTORY_QUERY_KEY]: void 0 });
  }, [host, reading.query]);
  const openWorkflow = useCallback(
    (agent: AgentWithFields) => {
      if (agent.workflowId && project?.slug) {
        host.navigate(`/${project.slug}/studio/${agent.workflowId}`);
      }
    },
    [host, project?.slug],
  );

  const agentsChanged = useCallback(
    () => utils.agents.getAll.invalidate({ projectId }),
    [projectId, utils.agents.getAll],
  );
  const agentArchived = useCallback(async () => {
    await agentsChanged();
    // Archiving frees a seat against the plan's agent limit, so every create
    // button that pre-checks it has to re-ask.
    await utils.licenseEnforcement.checkLimit.invalidate();
  }, [agentsChanged, utils.licenseEnforcement.checkLimit]);

  const navigation = useMemo(
    () => new ScreenNavigation({ openEditor, openTypeSelector, openHistory, openWorkflow }),
    [openEditor, openHistory, openTypeSelector, openWorkflow],
  );
  const lifecycle = useMemo(
    () => new ScreenLifecycle({ agentsChanged, agentArchived }),
    [agentArchived, agentsChanged],
  );
  const composition = useMemo(() => new ScreenComposition(host), [host]);
  const feedback = useMemo(() => new ScreenFeedback(host), [host]);

  const historyAgent = useMemo(
    () => items.find((agent) => agent.id === historyAgentId),
    [historyAgentId, items],
  );

  if (!project) return null;

  return (
    <>
      <AgentManagementPage
        data={{
          projectId: project.id,
          agents,
          items,
          isLoading: agentsQuery.isLoading,
          copyProjects: [...host.copyTargets()],
        }}
        navigation={navigation}
        feedback={feedback}
        lifecycle={lifecycle}
        composition={composition}
        card={screenCard}
      />
      {isCreating && (
        <AgentTypeSelectorDrawer
          open
          onClose={closeTypeSelector}
          onSelect={(type: AgentType) => {
            closeTypeSelector();
            host.openAgentEditor({ drawer: getAgentEditorDrawer(type) });
          }}
        />
      )}
      {historyAgentId && (
        <AgentHistoryDrawer
          agentId={historyAgentId}
          agentName={historyAgent?.name ?? "Agent"}
          projectId={project.id}
          agents={agents}
          onClose={closeHistory}
          formatCreatedAt={(createdAt) => formatTimeAgo(createdAt.getTime())}
        />
      )}
    </>
  );
}

export default AgentManagementScreen;
