import type { AgentWithFields } from "@langwatch/agent-contract";
import {
  type AgentArchiveDialogInput,
  AgentCard as AgentCardPresentation,
  type AgentCardRenderInput,
  type AgentCopyDialogInput,
  AgentHistoryDrawer as AgentHistoryComposition,
  AgentManagementCardPort,
  AgentManagementFeedbackPort,
  AgentManagementLifecyclePort,
  AgentManagementNavigationPort,
  AgentManagementPage,
  AgentPageCompositionPort,
  type AgentPushDialogInput,
  getAgentEditorDrawer,
} from "@langwatch/agent-web/screens/agent-management";
import { createLogger } from "@langwatch/observability";
import { trpcQueryKey } from "@langwatch/platform-api-client";
import { RpcClientPort, TrpcAgentBrowserAdapter } from "@langwatch/ui";
import { Spacer } from "@chakra-ui/react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { getUntypedClient } from "@trpc/client";
import { Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import { CascadeArchiveDialog } from "~/components/CascadeArchiveDialog";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PushToCopiesDialog } from "~/components/ui/PushToCopiesDialog";
import { ReplicateToProjectDialog } from "~/components/ui/ReplicateToProjectDialog";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { showErrorToast } from "~/features/errors";
import { LangyContextTarget } from "@langwatch/langy-web";
import { agentContextChip } from "@langwatch/langy-web";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectsForCopy } from "~/hooks/useProjectsForCopy";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { api, trpcClient } from "~/utils/api";

const logger = createLogger("AgentUiHost");

export class PlatformRpcClient extends RpcClientPort {
  private readonly client;

  constructor(private readonly queryClient: QueryClient) {
    super();
    this.client = getUntypedClient(trpcClient);
  }

  /**
   * Keyed the way tRPC keys it, not under a namespace of our own.
   *
   * `["agent-ui", path, input]` shares no prefix with any tRPC key, so what the
   * agent read sat in a cache the rest of the application could not see: an
   * `invalidate()` anywhere else left it stale, and the invalidation below
   * reached nothing but itself. Same QueryClient plus the same encoding means a
   * procedure the agent read and a procedure a hook read are one cache entry.
   */
  query(path: string, input: unknown): Promise<unknown> {
    return this.queryClient.fetchQuery({
      queryKey: trpcQueryKey(path, { input, type: "query" }),
      queryFn: () => this.client.query(path, input),
    });
  }

  async mutate(path: string, input: unknown): Promise<unknown> {
    const mutation = this.queryClient.getMutationCache().build(this.queryClient, {
      mutationFn: () => this.client.mutation(path, input),
    });
    const output = await mutation.execute(input);
    // Everything, because this adapter dispatches whatever procedure path the
    // agent names and has no way to know what a given mutation touched. The
    // old `["agent-ui"]` filter looked narrower but only ever matched this
    // adapter's own private cache, so the page behind the agent never
    // refreshed at all.
    await this.queryClient.invalidateQueries();
    return output;
  }
}

function useAgentBrowser() {
  const queryClient = useQueryClient();
  return useMemo(
    () => TrpcAgentBrowserAdapter.create(new PlatformRpcClient(queryClient)),
    [queryClient],
  );
}

class PlatformAgentPageComposition extends AgentPageCompositionPort {
  renderHeader({ onCreate }: { onCreate: () => void }) {
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

  renderArchiveDialog(input: AgentArchiveDialogInput) {
    return (
      <CascadeArchiveDialog
        open={input.open}
        onClose={input.onClose}
        onConfirm={input.onConfirm}
        isLoading={input.isLoading}
        isLoadingRelated={input.isLoadingRelated}
        entityType="agent"
        entityName={input.agentName}
        relatedEntities={{
          workflows: input.relatedEntities?.workflow ? [input.relatedEntities.workflow] : [],
        }}
      />
    );
  }

  renderCopyDialog(input: AgentCopyDialogInput) {
    return (
      <ReplicateToProjectDialog
        open={input.open}
        onClose={input.onClose}
        title="Replicate Agent"
        entityLabel="Agent"
        sourceName={input.agentName}
        sourceId={input.agentId}
        sourceProjectId={input.sourceProjectId}
        projects={input.projects}
        onCopy={({ projectId }) => input.onCopy(projectId)}
        isLoading={input.isLoading}
        logError={logger.error.bind(logger)}
      />
    );
  }

  renderPushDialog(input: AgentPushDialogInput) {
    return (
      <PushToCopiesDialog
        open={input.open}
        onClose={input.onClose}
        entityLabel="Agent"
        sourceName={input.agentName}
        copies={input.copies}
        isLoading={input.isLoading}
        error={input.error}
        selectedCopyIds={input.selectedCopyIds}
        onToggleCopy={input.onToggleCopy}
        onPush={input.onPush}
        pushLoading={input.isPushing}
      />
    );
  }
}

const agentPageComposition = new PlatformAgentPageComposition();

class PlatformAgentCard extends AgentManagementCardPort {
  render(input: AgentCardRenderInput) {
    const { agent, ...callbacks } = input;

    return (
      <LangyContextTarget target={agentContextChip({ agentId: agent.id, name: agent.name })}>
        <AgentCardPresentation
          agent={agent}
          updatedAtLabel={formatAgentUpdatedAt(agent.updatedAt)}
          {...callbacks}
        />
      </LangyContextTarget>
    );
  }
}

const agentCard = new PlatformAgentCard();

class PlatformAgentNavigation extends AgentManagementNavigationPort {
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

class PlatformAgentFeedback extends AgentManagementFeedbackPort {
  showSuccess(input: { title: string; description?: string }): void {
    showAgentSuccess(input);
  }

  showError(input: { error: unknown; fallbackTitle: string }): void {
    showAgentError(input);
  }
}

const agentFeedback = new PlatformAgentFeedback();

class PlatformAgentLifecycle extends AgentManagementLifecyclePort {
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

function formatAgentUpdatedAt(value: Date): string {
  return formatTimeAgo(value.getTime()) ?? "";
}

function showAgentSuccess(input: { title: string; description?: string }): void {
  toaster.create({ ...input, type: "success" });
}

function showAgentError(input: { error: unknown; fallbackTitle: string }): void {
  showErrorToast(input);
}

function AgentPageRoute() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const copyProjects = useProjectsForCopy("evaluations:manage");
  const router = useRouter();
  const utils = api.useUtils();
  const agents = useAgentBrowser();
  const agentsQuery = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: Boolean(project) },
  );
  const openEditor = useCallback(
    (agent: AgentWithFields) => {
      openDrawer(getAgentEditorDrawer(agent.type), {
        urlParams: { agentId: agent.id },
      });
    },
    [openDrawer],
  );
  const openTypeSelector = useCallback(() => openDrawer("agentTypeSelector"), [openDrawer]);
  const openHistory = useCallback(
    (agent: AgentWithFields) => {
      openDrawer("agentHistory", {
        urlParams: { agentId: agent.id, agentName: agent.name },
      });
    },
    [openDrawer],
  );
  const openWorkflow = useCallback(
    (agent: AgentWithFields) => {
      if (agent.workflowId && project?.slug) {
        void router.push(`/${project.slug}/studio/${agent.workflowId}`);
      }
    },
    [project?.slug, router],
  );
  const agentsChanged = useCallback(
    () => utils.agents.getAll.invalidate({ projectId: project?.id ?? "" }),
    [project?.id, utils.agents.getAll],
  );
  const agentArchived = useCallback(async () => {
    await agentsChanged();
    await utils.licenseEnforcement.checkLimit.invalidate();
  }, [agentsChanged, utils.licenseEnforcement.checkLimit]);
  const navigation = useMemo(
    () => new PlatformAgentNavigation({ openEditor, openTypeSelector, openHistory, openWorkflow }),
    [openEditor, openHistory, openTypeSelector, openWorkflow],
  );
  const lifecycle = useMemo(
    () => new PlatformAgentLifecycle({ agentsChanged, agentArchived }),
    [agentArchived, agentsChanged],
  );

  if (!project) return null;

  return (
    <DashboardLayout>
      <AgentManagementPage
        data={{
          projectId: project.id,
          agents,
          items: agentsQuery.data ?? [],
          isLoading: agentsQuery.isLoading,
          copyProjects,
        }}
        navigation={navigation}
        feedback={agentFeedback}
        lifecycle={lifecycle}
        composition={agentPageComposition}
        card={agentCard}
      />
    </DashboardLayout>
  );
}

export function AgentHistoryDrawer() {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();
  const agents = useAgentBrowser();

  if (!project || !params.agentId || !params.agentName) return null;

  return (
    <AgentHistoryComposition
      agentId={params.agentId}
      agentName={params.agentName}
      projectId={project.id}
      agents={agents}
      onClose={closeDrawer}
      formatCreatedAt={(createdAt) => formatTimeAgo(createdAt.getTime()) ?? ""}
    />
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: DashboardLayout,
})(AgentPageRoute);
