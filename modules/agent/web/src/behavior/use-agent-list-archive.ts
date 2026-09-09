import { useEffect, useState } from "react";
import type { RelatedAgentEntities, AgentCascadeArchive } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import type { AgentBrowser } from "../model/agent-client.ts";

export interface AgentListArchiveOptions {
  onGetRelated(agentId: string): Promise<RelatedAgentEntities>;
  onDelete(agentId: string): Promise<void>;
  onCascadeArchive(agentId: string): Promise<WireOf<AgentCascadeArchive>>;
  onArchived(workflowArchived: boolean): void;
  onError(error: unknown): void;
}

export function useAgentListArchive(props: AgentListArchiveOptions) {
  const [agentToDelete, setAgentToDelete] = useState<AgentBrowser | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const { related, isLoadingRelated } = useRelatedEntities(agentToDelete, setAgentToDelete, props);

  async function confirmDeleteAgent() {
    if (!agentToDelete || isLoadingRelated || !related) return;
    setIsArchiving(true);
    try {
      if (related?.workflow) {
        const result = await props.onCascadeArchive(agentToDelete.id);
        props.onArchived(Boolean(result.archivedWorkflow));
      } else {
        await props.onDelete(agentToDelete.id);
        props.onArchived(false);
      }
      setAgentToDelete(null);
    } catch (error) {
      props.onError(error);
    } finally {
      setIsArchiving(false);
    }
  }

  return {
    agentToDelete,
    setAgentToDelete,
    related,
    isLoadingRelated,
    isArchiving,
    confirmDeleteAgent,
  };
}

function useRelatedEntities(
  agentToDelete: AgentBrowser | null,
  setAgentToDelete: (agent: AgentBrowser | null) => void,
  props: AgentListArchiveOptions,
) {
  const [related, setRelated] = useState<RelatedAgentEntities | null>(null);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  useEffect(() => {
    if (!agentToDelete) {
      setRelated(null);
      return;
    }
    let active = true;
    setRelated(null);
    setIsLoadingRelated(true);
    void props
      .onGetRelated(agentToDelete.id)
      .then((value) => {
        if (active) setRelated(value);
      })
      .catch((error: unknown) => {
        if (active) {
          setAgentToDelete(null);
          props.onError(error);
        }
      })
      .finally(() => {
        if (active) setIsLoadingRelated(false);
      });
    return () => {
      active = false;
    };
  }, [agentToDelete, props.onGetRelated, props.onError]);

  return { related, isLoadingRelated };
}
