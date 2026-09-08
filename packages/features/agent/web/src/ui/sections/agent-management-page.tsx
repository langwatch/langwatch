import {
  useAgentManagement,
  type AgentManagementFeedbackPort,
  type AgentManagementLifecyclePort,
} from "../../behavior/use-agent-management.ts";
export type {
  AgentManagementFeedbackPort,
  AgentManagementLifecyclePort,
} from "../../behavior/use-agent-management.ts";
import { Button, Center, EmptyState, Grid, Skeleton, VStack } from "@chakra-ui/react";
import type {
  AgentCopy,
  AgentWithFields as StoredAgentWithFields,
  RelatedAgentEntities,
} from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import { Bot, Plus } from "lucide-react";
import { Fragment, type ComponentType, type ReactNode } from "react";
import type { AgentClient, ConnectedAgentBrowser } from "../../model/agent-client.ts";

/**
 * An agent the way this page holds one: off a query, so its instants are the
 * ISO strings the wire carries rather than the `Date`s the server built.
 */
export type AgentWithFields = WireOf<StoredAgentWithFields>;

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
export interface AgentPageCompositionPort {
  renderHeader(input: { onCreate: () => void }): ReactNode;

  renderArchiveDialog(input: AgentArchiveDialogInput): ReactNode;

  renderCopyDialog(input: AgentCopyDialogInput): ReactNode;

  renderPushDialog(input: AgentPushDialogInput): ReactNode;
}

export type AgentManagementData = {
  projectId: string;
  agents: AgentClient;
  items: AgentWithFields[];
  isLoading: boolean;
  copyProjects: AgentCopyProject[];
};

export interface AgentManagementNavigationPort {
  openEditor(agent: AgentWithFields): void;

  openTypeSelector(): void;

  openHistory(agent: AgentWithFields): void;

  openWorkflow(agent: AgentWithFields): void;
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
  onTest?: () => void;
};

export interface AgentManagementCardPort {
  render(input: AgentCardRenderInput): ReactNode;
}

/**
 * The connected agents' own card grid (ADR-128), when the host mounts one.
 * `agents` are the SAME `ConnectedAgentBrowser` rows the host answered off
 * `data.items`; deleting one reuses this page's own archive dialog, so a
 * connected agent's delete confirmation reads exactly like every other
 * agent's.
 */
export type AgentManagementConnectedSection = {
  Component: ComponentType<{
    agents: ConnectedAgentBrowser[];
    onOpen: (agent: ConnectedAgentBrowser) => void;
    onDelete?: (agent: ConnectedAgentBrowser) => void;
    onTest?: (agent: ConnectedAgentBrowser) => void;
  }>;
  agents: ConnectedAgentBrowser[];
  onOpen: (agent: ConnectedAgentBrowser) => void;
};

export type AgentManagementPageProps = {
  data: AgentManagementData;
  navigation: AgentManagementNavigationPort;
  feedback: AgentManagementFeedbackPort;
  lifecycle: AgentManagementLifecyclePort;
  composition: AgentPageCompositionPort;
  card: AgentManagementCardPort;
  connectedSection?: AgentManagementConnectedSection;
  onTest?: (agentId: string) => void;
};

export function AgentManagementPage(props: AgentManagementPageProps) {
  const {
    agentToDelete,
    setAgentToDelete,
    relatedEntities,
    isLoadingRelated,
    isArchiving,
    agentForCopy,
    setAgentForCopy,
    isCopying,
    agentForPush,
    setAgentForPush,
    copies,
    isLoadingCopies,
    copiesError,
    selectedCopyIds,
    setSelectedCopyIds,
    isPushing,
    handleArchive,
    handleCopy,
    handlePush,
    handleSync,
  } = useAgentManagement(props);

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
                onTest={props.onTest ? (agent) => props.onTest?.(agent.id) : void 0}
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
                  onOpenWorkflow: () => props.navigation.openWorkflow(agent),
                  onReplicate: () => setAgentForCopy({ id: agent.id, name: agent.name }),
                  onPushToCopies: () => setAgentForPush({ id: agent.id, name: agent.name }),
                  onSyncFromSource: () => void handleSync(agent.id),
                  onViewHistory: () => props.navigation.openHistory(agent),
                  onTest: props.onTest ? () => props.onTest?.(agent.id) : void 0,
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
