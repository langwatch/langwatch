import type {
  AgentCopy,
  AgentWithFields as StoredAgentWithFields,
  RelatedAgentEntities,
} from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import { useEffect, useState } from "react";
import type { AgentClient } from "../model/agent-client.ts";

type AgentWithFields = WireOf<StoredAgentWithFields>;

export interface AgentManagementFeedback {
  showSuccess(input: { title: string; description?: string }): void;
  showError(input: { error: unknown; fallbackTitle: string }): void;
}

export interface AgentManagementLifecycle {
  agentsChanged(): Promise<void>;
  agentArchived(): Promise<void>;
}

type SelectedAgent = {
  id: string;
  name: string;
};

type AgentManagementOptions = {
  data: { projectId: string; agents: AgentClient };
  feedback: AgentManagementFeedback;
  lifecycle: AgentManagementLifecycle;
};

function useAgentRelatedEntities(
  selectedAgent: AgentWithFields | null,
  props: AgentManagementOptions,
  clearSelection: (selection: null) => void,
) {
  const [relatedEntities, setRelatedEntities] = useState<RelatedAgentEntities | null>(null);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  useEffect(() => {
    if (!selectedAgent) {
      setRelatedEntities(null);
      return;
    }

    let active = true;
    setIsLoadingRelated(true);
    setRelatedEntities(null);

    void props.data.agents
      .relatedEntities({ id: selectedAgent.id, projectId: props.data.projectId })
      .then((result) => active && setRelatedEntities(result))
      .catch((error: unknown) => {
        if (active) {
          clearSelection(null);
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
  }, [selectedAgent, props.data.agents, props.data.projectId, props.feedback, clearSelection]);

  return { relatedEntities, isLoadingRelated };
}
function useAgentArchive(props: AgentManagementOptions) {
  const [agentToDelete, setAgentToDelete] = useState<AgentWithFields | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const { relatedEntities, isLoadingRelated } = useAgentRelatedEntities(
    agentToDelete,
    props,
    setAgentToDelete,
  );
  const handleArchive = async () => {
    if (!agentToDelete || isLoadingRelated || !relatedEntities) return;

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

  return {
    agentToDelete,
    setAgentToDelete,
    relatedEntities,
    isLoadingRelated,
    isArchiving,
    handleArchive,
  };
}

function useAgentCopy(props: AgentManagementOptions) {
  const [agentForCopy, setAgentForCopy] = useState<SelectedAgent | null>(null);
  const [isCopying, setIsCopying] = useState(false);
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

  return { agentForCopy, setAgentForCopy, isCopying, handleCopy };
}

function useAgentPush(props: AgentManagementOptions) {
  const [agentForPush, setAgentForPush] = useState<SelectedAgent | null>(null);
  const [copies, setCopies] = useState<AgentCopy[]>([]);
  const [isLoadingCopies, setIsLoadingCopies] = useState(false);
  const [copiesError, setCopiesError] = useState<unknown>(null);
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(new Set());
  const [isPushing, setIsPushing] = useState(false);
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

  return {
    agentForPush,
    setAgentForPush,
    copies,
    isLoadingCopies,
    copiesError,
    selectedCopyIds,
    setSelectedCopyIds,
    isPushing,
    handlePush,
  };
}

export function useAgentManagement(props: AgentManagementOptions) {
  const archive = useAgentArchive(props);
  const copy = useAgentCopy(props);
  const push = useAgentPush(props);
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

  return { ...archive, ...copy, ...push, handleSync };
}
