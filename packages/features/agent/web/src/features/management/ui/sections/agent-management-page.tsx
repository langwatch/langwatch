import { Button, Center, EmptyState, Grid, Skeleton, VStack } from "@chakra-ui/react";
import type {
  AgentCopy,
  AgentWithFields,
  ConnectedAgentView,
  RelatedAgentEntities,
} from "@langwatch/agent-contract";
import { Bot, Plus } from "lucide-react";
import { Fragment, type ComponentType, type ReactNode, useEffect, useState } from "react";
import type { AgentBrowserPort } from "../../../../model/agent-browser.port";

export type AgentCopyProject = {
  label: string;
  value: string;
  hasCreatePermission: boolean;
};

export type AgentArchiveDialogInput = {
  open: boolean;
  agentName: string;
  relatedEntities: RelatedAgentEntities | null;
  isLoading: boolean;
  isLoadingRelated: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export type AgentCopyDialogInput = {
  open: boolean;
  agentId: string;
  agentName: string;
  sourceProjectId: string;
  projects: AgentCopyProject[];
  isLoading: boolean;
  onClose: () => void;
  onCopy: (targetProjectId: string) => Promise<void>;
};

export type AgentPushDialogInput = {
  open: boolean;
  agentName: string;
  copies: AgentCopy[];
  isLoading: boolean;
  error: unknown;
  selectedCopyIds: Set<string>;
  isPushing: boolean;
  onClose: () => void;
  onToggleCopy: (copyId: string) => void;
  onPush: () => Promise<{ pushedTo: number; selectedCopies: number }>;
};

/** Route-shell rendering kept outside reusable Agent browser behaviour. */
export abstract class AgentPageCompositionPort {
  abstract renderHeader(input: { onCreate: () => void }): ReactNode;

  abstract renderArchiveDialog(input: AgentArchiveDialogInput): ReactNode;

  abstract renderCopyDialog(input: AgentCopyDialogInput): ReactNode;

  abstract renderPushDialog(input: AgentPushDialogInput): ReactNode;
}

export type AgentManagementData = {
  projectId: string;
  agents: AgentBrowserPort;
  items: AgentWithFields[];
  isLoading: boolean;
  copyProjects: AgentCopyProject[];
};

export abstract class AgentManagementNavigationPort {
  abstract openEditor(agent: AgentWithFields): void;

  abstract openTypeSelector(): void;

  abstract openHistory(agent: AgentWithFields): void;

  abstract openWorkflow(agent: AgentWithFields): void;
}

export abstract class AgentManagementFeedbackPort {
  abstract showSuccess(input: { title: string; description?: string }): void;

  abstract showError(input: { error: unknown; fallbackTitle: string }): void;
}

export abstract class AgentManagementLifecyclePort {
  abstract agentsChanged(): Promise<void>;

  abstract agentArchived(): Promise<void>;
}

export type AgentCardRenderInput = {
  agent: AgentWithFields;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenWorkflow?: () => void;
  onReplicate?: () => void;
  onPushToCopies?: () => void;
  onSyncFromSource?: () => void;
  onViewHistory?: () => void;
};

export abstract class AgentManagementCardPort {
  abstract render(input: AgentCardRenderInput): ReactNode;
}

/**
 * The connected agents' own card grid (ADR-128), when the host mounts one.
 * `agents` are the SAME `ConnectedAgentView` rows the host answered off
 * `data.items`; deleting one reuses this page's own archive dialog, so a
 * connected agent's delete confirmation reads exactly like every other
 * agent's.
 */
export type AgentManagementConnectedSection = {
  Component: ComponentType<{
    agents: ConnectedAgentView[];
    onOpen: (agent: ConnectedAgentView) => void;
    onDelete?: (agent: ConnectedAgentView) => void;
  }>;
  agents: ConnectedAgentView[];
  onOpen: (agent: ConnectedAgentView) => void;
};

export type AgentManagementPageProps = {
  data: AgentManagementData;
  navigation: AgentManagementNavigationPort;
  feedback: AgentManagementFeedbackPort;
  lifecycle: AgentManagementLifecyclePort;
  composition: AgentPageCompositionPort;
  card: AgentManagementCardPort;
  connectedSection?: AgentManagementConnectedSection;
};

type SelectedAgent = {
  id: string;
  name: string;
};

export function AgentManagementPage(props: AgentManagementPageProps) {
  const [agentToDelete, setAgentToDelete] = useState<AgentWithFields | null>(null);
  const [relatedEntities, setRelatedEntities] = useState<RelatedAgentEntities | null>(null);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [agentForCopy, setAgentForCopy] = useState<SelectedAgent | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [agentForPush, setAgentForPush] = useState<SelectedAgent | null>(null);
  const [copies, setCopies] = useState<AgentCopy[]>([]);
  const [isLoadingCopies, setIsLoadingCopies] = useState(false);
  const [copiesError, setCopiesError] = useState<unknown>(null);
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(new Set());
  const [isPushing, setIsPushing] = useState(false);

  useEffect(() => {
    if (!agentToDelete) {
      setRelatedEntities(null);
      return;
    }

    let active = true;
    setIsLoadingRelated(true);

    void props.data.agents
      .relatedEntities({ id: agentToDelete.id, projectId: props.data.projectId })
      .then((result) => active && setRelatedEntities(result))
      .catch((error: unknown) => {
        if (active) {
          props.feedback.showError({
            error,
            fallbackTitle: "Couldn't load related agent resources",
          });
        }
      })
      .finally(() => active && setIsLoadingRelated(false));

    return () => {
      active = false;
    };
  }, [agentToDelete, props.data.agents, props.data.projectId, props.feedback]);

  useEffect(() => {
    if (!agentForPush) {
      setCopies([]);
      setSelectedCopyIds(new Set());
      setCopiesError(null);
      return;
    }

    let active = true;
    setIsLoadingCopies(true);
    setCopiesError(null);

    void props.data.agents
      .getCopies({ projectId: props.data.projectId, agentId: agentForPush.id })
      .then((result) => {
        if (!active) return;

        setCopies(result);
        setSelectedCopyIds(new Set(result.map((copy) => copy.id)));
      })
      .catch((error: unknown) => active && setCopiesError(error))
      .finally(() => active && setIsLoadingCopies(false));

    return () => {
      active = false;
    };
  }, [agentForPush, props.data.agents, props.data.projectId]);

  const handleArchive = async () => {
    if (!agentToDelete) return;

    setIsArchiving(true);

    try {
      if (relatedEntities?.workflow) {
        const result = await props.data.agents.cascadeArchive({
          id: agentToDelete.id,
          projectId: props.data.projectId,
        });
        props.feedback.showSuccess({
          title: "Agent deleted",
          description: result.archivedWorkflow ? "Also deleted: 1 workflow" : void 0,
        });
      } else {
        await props.data.agents.archive({
          id: agentToDelete.id,
          projectId: props.data.projectId,
        });
        props.feedback.showSuccess({ title: "Agent deleted" });
      }

      setAgentToDelete(null);
      await props.lifecycle.agentArchived();
    } catch (error) {
      props.feedback.showError({ error, fallbackTitle: "Couldn't delete agent" });
    } finally {
      setIsArchiving(false);
    }
  };

  const handleCopy = async (targetProjectId: string) => {
    if (!agentForCopy) return;

    setIsCopying(true);

    try {
      await props.data.agents.copy({
        agentId: agentForCopy.id,
        projectId: targetProjectId,
        sourceProjectId: props.data.projectId,
      });
      setAgentForCopy(null);
      await props.lifecycle.agentsChanged();
    } finally {
      setIsCopying(false);
    }
  };

  const handlePush = async () => {
    if (!agentForPush) {
      return { pushedTo: 0, selectedCopies: 0 };
    }

    setIsPushing(true);

    try {
      const result = await props.data.agents.pushToCopies({
        agentId: agentForPush.id,
        projectId: props.data.projectId,
        copyIds: [...selectedCopyIds],
      });
      setAgentForPush(null);
      await props.lifecycle.agentsChanged();
      return result;
    } finally {
      setIsPushing(false);
    }
  };

  const handleSync = async (agentId: string) => {
    try {
      await props.data.agents.syncFromSource({
        agentId,
        projectId: props.data.projectId,
      });
      await props.lifecycle.agentsChanged();
      props.feedback.showSuccess({
        title: "Agent updated",
        description: "Agent has been updated from source.",
      });
    } catch (error) {
      props.feedback.showError({
        error,
        fallbackTitle: "Couldn't update agent from source",
      });
    }
  };

  const hasAgents = props.data.items.length > 0;
  const showEmptyState = !props.data.isLoading && !hasAgents;
  // Connected agents draw their own card via `connectedSection`; every other
  // type keeps the grid below.
  const otherItems = props.data.items.filter((agent) => agent.type !== "connected");

  return (
    <>
      {props.composition.renderHeader({
        onCreate: () => props.navigation.openTypeSelector(),
      })}

      {showEmptyState ? (
        <Center flex={1} padding={6}>
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Bot size={32} />
              </EmptyState.Indicator>
              <EmptyState.Title>No agents yet</EmptyState.Title>
              <EmptyState.Description>
                Create reusable agents for your evaluations.
              </EmptyState.Description>
              <Button colorPalette="blue" onClick={() => props.navigation.openTypeSelector()}>
                <Plus size={16} /> Create your first agent
              </Button>
            </EmptyState.Content>
          </EmptyState.Root>
        </Center>
      ) : (
        <VStack gap={6} width="full" align="start" padding={6}>
          <Grid templateColumns="repeat(auto-fill, minmax(300px, 1fr))" gap={4} width="full">
            {props.data.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} height="100px" borderRadius="md" />
              ))}
            {props.connectedSection && (
              <props.connectedSection.Component
                agents={props.connectedSection.agents}
                onOpen={props.connectedSection.onOpen}
                onDelete={(connected) =>
                  setAgentToDelete(
                    props.data.items.find((item) => item.id === connected.id) ?? null,
                  )
                }
              />
            )}
            {otherItems.map((agent) => (
              <Fragment key={agent.id}>
                {props.card.render({
                  agent,
                  onClick: () => props.navigation.openEditor(agent),
                  onEdit: () => props.navigation.openEditor(agent),
                  onDelete: () => setAgentToDelete(agent),
                  onOpenWorkflow:
                    agent.type === "workflow" ? () => props.navigation.openWorkflow(agent) : void 0,
                  onReplicate: () => setAgentForCopy({ id: agent.id, name: agent.name }),
                  onPushToCopies: () => setAgentForPush({ id: agent.id, name: agent.name }),
                  onSyncFromSource: () => void handleSync(agent.id),
                  onViewHistory: () => props.navigation.openHistory(agent),
                })}
              </Fragment>
            ))}
          </Grid>
        </VStack>
      )}

      {props.composition.renderArchiveDialog({
        open: agentToDelete !== null,
        agentName: agentToDelete?.name ?? "",
        relatedEntities,
        isLoading: isArchiving,
        isLoadingRelated,
        onClose: () => setAgentToDelete(null),
        onConfirm: () => void handleArchive(),
      })}
      {props.composition.renderCopyDialog({
        open: agentForCopy !== null,
        agentId: agentForCopy?.id ?? "",
        agentName: agentForCopy?.name ?? "",
        sourceProjectId: props.data.projectId,
        projects: props.data.copyProjects,
        isLoading: isCopying,
        onClose: () => setAgentForCopy(null),
        onCopy: handleCopy,
      })}
      {props.composition.renderPushDialog({
        open: agentForPush !== null,
        agentName: agentForPush?.name ?? "",
        copies,
        isLoading: isLoadingCopies,
        error: copiesError,
        selectedCopyIds,
        isPushing,
        onClose: () => setAgentForPush(null),
        onToggleCopy: (copyId) => {
          setSelectedCopyIds((current) => {
            const next = new Set(current);
            if (next.has(copyId)) {
              next.delete(copyId);
            } else {
              next.add(copyId);
            }
            return next;
          });
        },
        onPush: handlePush,
      })}
    </>
  );
}
