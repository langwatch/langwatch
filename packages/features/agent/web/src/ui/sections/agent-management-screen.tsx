import { Alert, Button, Spacer } from "@chakra-ui/react";
import type { ConnectedAgentBrowser } from "../../model/agent-client.ts";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { toEpochMs } from "@langwatch/time";
import { Plus } from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";
import { agentApi } from "../../behavior/agent-api.ts";
import { getAgentEditorDrawer } from "../../model/get-agent-editor-drawer.ts";
import { AgentTypeSelectorDrawer, type AgentType } from "./agent-type-selector-drawer.tsx";
import { AgentHistoryDrawer } from "./agent-history-drawer.tsx";
import { AgentArchiveDialog } from "../blocks/agent-archive-dialog.tsx";
import { AgentPushDialog } from "../blocks/agent-push-dialog.tsx";
import { AgentReplicateDialog } from "../blocks/agent-replicate-dialog.tsx";
import { ConnectedAgentsSection } from "../blocks/connected-agents-section.tsx";
import { AgentCard } from "../blocks/agent-card.tsx";
import {
  type AgentManagementCardPort,
  AgentManagementPage,
  type AgentPageCompositionPort,
  type AgentArchiveDialogInput,
  type AgentCardRenderInput,
  type AgentCopyDialogInput,
  type AgentPushDialogInput,
  type AgentWithFields,
} from "./agent-management-page.tsx";
import { formatTimeAgo } from "@langwatch/ui-host/format-time-ago";
import {
  useAgentManagementHost,
  type AgentManagementHost,
} from "../../model/agent-management-host.ts";

export const AGENT_HISTORY_QUERY_KEY = "history";

export const AGENT_NEW_QUERY_KEY = "new";

export const AGENT_NEW_QUERY_VALUE = "agent";

class ScreenComposition implements AgentPageCompositionPort {
  constructor(private readonly host: AgentManagementHost) {}

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

class ScreenCard implements AgentManagementCardPort {
  render({ agent, ...callbacks }: AgentCardRenderInput): ReactNode {
    return (
      <AgentCard
        agent={agent}
        updatedAtLabel={formatTimeAgo(toEpochMs(agent.updatedAt)) ?? ""}
        {...callbacks}
      />
    );
  }
}

const screenCard = new ScreenCard();

export function AgentManagementScreen() {
  const host = useAgentManagementHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const utils = agentApi.useUtils();
  const agents = host.agents();

  const testRun = agentApi.agents.testRun.useMutation({
    onSuccess: (run) => host.openTestRun(run),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't start the test run" }),
  });

  const agentsQuery = agentApi.agents.getAll.useQuery({ projectId }, { enabled: Boolean(project) });

  const items = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  // The connected agents draw their own card (ADR-128); `items` keeps every
  // type, including these, for the archive dialog's own lookup by id.
  const connectedAgents = useMemo<ConnectedAgentBrowser[]>(
    () =>
      items
        .filter((agent) => agent.type === "connected")
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          environment: agent.environment ?? null,
          hostLabel: agent.hostLabel ?? null,
          lastSeenAt: agent.lastSeenAt ?? null,
          status: agent.status,
          instances: agent.instances,
          owner: agent.owner,
          selectable: agent.selectable,
          notSelectableReason: agent.notSelectableReason,
          parameters: agent.parameters,
          config: agent.config,
        })),
    [items],
  );
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
    await host.refreshAgentLimit();
  }, [agentsChanged, host]);

  const navigation = { openEditor, openTypeSelector, openHistory, openWorkflow };
  const lifecycle = { agentsChanged, agentArchived };
  const composition = useMemo(() => new ScreenComposition(host), [host]);
  const feedback = useMemo(
    () => ({
      showSuccess: (notice: { title: string; description?: string }) => host.succeeded(notice),
      showError: (failure: { error: unknown; fallbackTitle: string }) => host.failed(failure),
    }),
    [host],
  );

  const historyAgent = useMemo(
    () => items.find((agent) => agent.id === historyAgentId),
    [historyAgentId, items],
  );

  if (!project) return null;

  if (agentsQuery.error) {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Content>
          {host.describeFailure({
            error: agentsQuery.error,
            fallbackTitle: "Couldn't load agents",
          })}
        </Alert.Content>
        <Button
          size="sm"
          variant="outline"
          loading={agentsQuery.isFetching}
          onClick={() => void agentsQuery.refetch()}
        >
          Retry
        </Button>
      </Alert.Root>
    );
  }

  return (
    <>
      <AgentManagementPage
        key={project.id}
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
        onTest={(agentId) => testRun.mutate({ projectId, agentId })}
        connectedSection={{
          Component: ConnectedAgentsSection,
          agents: connectedAgents,
          onOpen: (agent) => host.openConnectedAgent(agent.id),
        }}
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
          key={`${project.id}:${historyAgentId}`}
          agentId={historyAgentId}
          agentName={historyAgent?.name ?? "Agent"}
          projectId={project.id}
          agents={agents}
          onClose={closeHistory}
          formatCreatedAt={(createdAt) => formatTimeAgo(createdAt.getTime()) ?? ""}
        />
      )}
    </>
  );
}

export default AgentManagementScreen;
