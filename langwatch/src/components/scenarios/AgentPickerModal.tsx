import { Code, Globe } from "lucide-react";
import { useMemo } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRecentTargets } from "../../hooks/useRecentTargets";
import { api } from "../../utils/api";
import { SearchablePickerDialog } from "../ui/searchable-picker-dialog";

interface AgentPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (agentId: string) => void;
  onCreateNew: () => void;
}

/**
 * Modal for selecting an agent to run a scenario against.
 * Shows recent agents, search, and all agents list.
 */
export function AgentPickerModal({
  open,
  onClose,
  onSelect,
  onCreateNew,
}: AgentPickerModalProps) {
  const { project } = useOrganizationTeamProject();
  const { data: agents, isLoading } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const { recentAgentIds } = useRecentTargets();

  // Filter to HTTP agents only (for now)
  const httpAgents = useMemo(() => {
    return agents?.filter((a) => a.type === "http") ?? [];
  }, [agents]);

  const hasAgents = httpAgents.length > 0;

  return (
    <SearchablePickerDialog.Root
      open={open}
      onClose={onClose}
      title="Run with Agent"
    >
      <SearchablePickerDialog.Body
        isLoading={isLoading}
        isEmpty={!hasAgents}
        emptyState={
          <SearchablePickerDialog.EmptyState
            icon={<Globe size={32} color="var(--chakra-colors-gray-400)" />}
            title="No agents yet"
            description="Create an agent to test your scenario against an external HTTP endpoint."
            actionLabel="Create new agent"
            onAction={onCreateNew}
          />
        }
      >
        <SearchablePickerDialog.SearchInput placeholder="Search agents..." />
        <SearchablePickerDialog.ScrollableContent>
          <AgentSections
            agents={httpAgents}
            recentIds={recentAgentIds}
            onSelect={onSelect}
          />
        </SearchablePickerDialog.ScrollableContent>
      </SearchablePickerDialog.Body>
      <SearchablePickerDialog.Footer
        actionLabel={hasAgents ? "Create new agent" : undefined}
        onAction={hasAgents ? onCreateNew : undefined}
      />
    </SearchablePickerDialog.Root>
  );
}

// ============================================================================
// Internal Components
// ============================================================================

interface Agent {
  id: string;
  name: string;
  type: string;
}

interface AgentSectionsProps {
  agents: Agent[];
  recentIds: string[];
  onSelect: (agentId: string) => void;
}

function AgentSections({ agents, recentIds, onSelect }: AgentSectionsProps) {
  const { searchValue } = SearchablePickerDialog.usePickerSearch();

  // Get recent agents that still exist
  const recentAgents = useMemo(() => {
    return recentIds
      .map((id) => agents.find((a) => a.id === id))
      .filter(Boolean) as Agent[];
  }, [recentIds, agents]);

  // Filter by search
  const filteredAgents = useMemo(() => {
    if (!searchValue) return agents;
    return agents.filter((a) =>
      a.name.toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [agents, searchValue]);

  // Filter recent by search too
  const filteredRecent = useMemo(() => {
    if (!searchValue) return recentAgents;
    return recentAgents.filter((a) =>
      a.name.toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [recentAgents, searchValue]);

  const hasResults = filteredAgents.length > 0;

  return (
    <>
      {/* Recent Section */}
      {filteredRecent.length > 0 && (
        <SearchablePickerDialog.Section title="Recent">
          {filteredRecent.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              onClick={() => onSelect(agent.id)}
            />
          ))}
        </SearchablePickerDialog.Section>
      )}

      {/* All Agents Section */}
      <SearchablePickerDialog.Section
        title={searchValue ? "Search Results" : "All Agents"}
      >
        {!hasResults ? (
          <SearchablePickerDialog.NoResults message="No agents found" />
        ) : (
          filteredAgents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              onClick={() => onSelect(agent.id)}
            />
          ))
        )}
      </SearchablePickerDialog.Section>
    </>
  );
}

interface AgentRowProps {
  agent: Agent;
  onClick: () => void;
}

function AgentRow({ agent, onClick }: AgentRowProps) {
  const Icon = agent.type === "http" ? Globe : Code;
  const typeLabel = agent.type === "http" ? "HTTP" : "Code";

  return (
    <SearchablePickerDialog.ItemRow
      icon={<Icon size={16} />}
      name={agent.name}
      secondaryText={typeLabel}
      onClick={onClick}
      testId={`agent-row-${agent.id}`}
    />
  );
}
