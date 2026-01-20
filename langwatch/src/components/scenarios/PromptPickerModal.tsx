import { BookText } from "lucide-react";
import { useMemo } from "react";
import { useRecentTargets } from "../../hooks/useRecentTargets";
import { useAllPromptsForProject } from "../../prompts/hooks/useAllPromptsForProject";
import { SearchablePickerDialog } from "../ui/searchable-picker-dialog";

interface PromptPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (promptId: string) => void;
  onCreateNew: () => void;
}

/**
 * Modal for selecting a prompt to run a scenario against.
 * Shows recent prompts, search, and all prompts list.
 */
export function PromptPickerModal({
  open,
  onClose,
  onSelect,
  onCreateNew,
}: PromptPickerModalProps) {
  const { data: prompts, isLoading } = useAllPromptsForProject();
  const { recentPromptIds } = useRecentTargets();

  // Filter to published prompts only (version > 0)
  const publishedPrompts = useMemo(() => {
    return prompts?.filter((p) => p.version > 0) ?? [];
  }, [prompts]);

  const hasPrompts = publishedPrompts.length > 0;

  return (
    <SearchablePickerDialog.Root
      open={open}
      onClose={onClose}
      title="Run with Prompt"
    >
      <SearchablePickerDialog.Body
        isLoading={isLoading}
        isEmpty={!hasPrompts}
        emptyState={
          <SearchablePickerDialog.EmptyState
            icon={<BookText size={32} color="var(--chakra-colors-gray-400)" />}
            title="No prompts yet"
            description="Create a prompt to test your scenario against a prompt configuration."
            actionLabel="Create new prompt"
            onAction={onCreateNew}
          />
        }
      >
        <SearchablePickerDialog.SearchInput placeholder="Search prompts..." />
        <SearchablePickerDialog.ScrollableContent>
          <PromptSections
            prompts={publishedPrompts}
            recentIds={recentPromptIds}
            onSelect={onSelect}
          />
        </SearchablePickerDialog.ScrollableContent>
        <SearchablePickerDialog.CreateButton
          label="Create new prompt"
          onClick={onCreateNew}
        />
      </SearchablePickerDialog.Body>
      <SearchablePickerDialog.Footer />
    </SearchablePickerDialog.Root>
  );
}

// ============================================================================
// Internal Components
// ============================================================================

interface Prompt {
  id: string;
  handle: string | null;
  model: string;
}

interface PromptSectionsProps {
  prompts: Prompt[];
  recentIds: string[];
  onSelect: (promptId: string) => void;
}

function PromptSections({ prompts, recentIds, onSelect }: PromptSectionsProps) {
  const { searchValue } = SearchablePickerDialog.usePickerSearch();

  // Get recent prompts that still exist
  const recentPrompts = useMemo(() => {
    return recentIds
      .map((id) => prompts.find((p) => p.id === id))
      .filter(Boolean) as Prompt[];
  }, [recentIds, prompts]);

  // Filter by search
  const filteredPrompts = useMemo(() => {
    if (!searchValue) return prompts;
    return prompts.filter((p) =>
      (p.handle ?? p.id).toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [prompts, searchValue]);

  // Filter recent by search too
  const filteredRecent = useMemo(() => {
    if (!searchValue) return recentPrompts;
    return recentPrompts.filter((p) =>
      (p.handle ?? p.id).toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [recentPrompts, searchValue]);

  const hasResults = filteredPrompts.length > 0;

  return (
    <>
      {/* Recent Section */}
      {filteredRecent.length > 0 && (
        <SearchablePickerDialog.Section title="Recent">
          {filteredRecent.map((prompt) => (
            <SearchablePickerDialog.ItemRow
              key={prompt.id}
              icon={<BookText size={16} />}
              name={prompt.handle ?? prompt.id}
              secondaryText={prompt.model}
              onClick={() => onSelect(prompt.id)}
              testId={`prompt-row-${prompt.id}`}
            />
          ))}
        </SearchablePickerDialog.Section>
      )}

      {/* All Prompts Section */}
      <SearchablePickerDialog.Section
        title={searchValue ? "Search Results" : "All Prompts"}
      >
        {!hasResults ? (
          <SearchablePickerDialog.NoResults message="No prompts found" />
        ) : (
          filteredPrompts.map((prompt) => (
            <SearchablePickerDialog.ItemRow
              key={prompt.id}
              icon={<BookText size={16} />}
              name={prompt.handle ?? prompt.id}
              secondaryText={prompt.model}
              onClick={() => onSelect(prompt.id)}
              testId={`prompt-row-${prompt.id}`}
            />
          ))
        )}
      </SearchablePickerDialog.Section>
    </>
  );
}
