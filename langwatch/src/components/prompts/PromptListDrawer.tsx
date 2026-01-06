import {
  Box,
  Button,
  Collapsible,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { groupBy } from "lodash-es";
import { ChevronRight, FileText, FolderOpen, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
} from "~/hooks/useDrawer";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";

export type PromptListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (prompt: {
    id: string;
    name: string;
    version?: number;
    versionId?: string;
    inputs?: Array<{ identifier: string; type: string }>;
    outputs?: Array<{ identifier: string; type: string }>;
  }) => void;
  onCreateNew?: () => void;
};

/**
 * Get display name from a prompt handle.
 * Handles folder-prefixed names like "shared/my-prompt" -> "my-prompt"
 */
const getDisplayHandle = (handle?: string | null): string => {
  if (!handle) return "Untitled";
  return handle.includes("/") ? handle.split("/")[1]! : handle;
};

/**
 * Drawer for selecting an existing prompt or creating a new one.
 * Features:
 * - Shows list of saved prompts grouped by folder
 * - Empty state with create CTA
 * - "+ New Prompt" button at top
 * - Folder collapsible sections
 */
export function PromptListDrawer(props: PromptListDrawerProps) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const flowCallbacks = getFlowCallbacks("promptList");

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    flowCallbacks?.onSelect ??
    (complexProps.onSelect as PromptListDrawerProps["onSelect"]);
  // Use flowCallbacks.onCreateNew if available (for evaluations context with availableSources)
  const onCreateNew =
    props.onCreateNew ??
    flowCallbacks?.onCreateNew ??
    (() => openDrawer("promptEditor"));
  const isOpen = props.open !== false && props.open !== undefined;

  const { data: prompts, isLoading } = useAllPromptsForProject();
  const [searchQuery, setSearchQuery] = useState("");

  // Filter and group prompts by folder (derived from handle prefix)
  const { groupedPrompts, hasPrompts, filteredCount } = useMemo(() => {
    const publishedPrompts =
      prompts?.filter((prompt) => prompt.version > 0) ?? [];

    // Filter by search query
    const filtered = searchQuery
      ? publishedPrompts.filter((prompt) =>
          prompt.handle?.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : publishedPrompts;

    const grouped = groupBy(filtered, (prompt) =>
      prompt.handle?.includes("/") ? prompt.handle.split("/")[0] : "default",
    );

    // Sort folders alphabetically, but put "default" last
    const sortedGroups = Object.entries(grouped).sort((a, b) => {
      if (a[0] === "default") return 1;
      if (b[0] === "default") return -1;
      return a[0].localeCompare(b[0]);
    });

    return {
      groupedPrompts: sortedGroups,
      hasPrompts: publishedPrompts.length > 0,
      filteredCount: filtered.length,
    };
  }, [prompts, searchQuery]);

  const handleSelectPrompt = (prompt: {
    id: string;
    handle: string | null;
  }) => {
    // Find the full prompt data to get inputs/outputs
    const fullPrompt = prompts?.find((p) => p.id === prompt.id);

    // Call onSelect and let the callback handle navigation if needed.
    // Don't call onClose() here - the callback may navigate to another drawer,
    // and closeDrawer would wipe the flow callbacks.
    // If the callback doesn't navigate, the drawer will remain open but
    // that's the expected behavior for selection-then-edit flows.
    onSelect?.({
      id: prompt.id,
      name: prompt.handle ?? "Untitled",
      version: fullPrompt?.version,
      versionId: fullPrompt?.versionId,
      inputs: fullPrompt?.inputs,
      outputs: fullPrompt?.outputs,
    });
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2} justify="space-between" width="full">
            <HStack gap={2}>
              {canGoBack && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  padding={1}
                  minWidth="auto"
                  data-testid="back-button"
                >
                  <LuArrowLeft size={20} />
                </Button>
              )}
              <Heading>Choose Prompt</Heading>
            </HStack>
            <Button
              size="sm"
              colorPalette="blue"
              onClick={onCreateNew}
              data-testid="new-prompt-button"
            >
              <Plus size={16} />
              New Prompt
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <VStack gap={2} align="stretch" paddingX={6} paddingTop={4}>
              <Text color="gray.600" fontSize="sm">
                Select an existing prompt or create a new one.
              </Text>

              {/* Search input */}
              {hasPrompts && (
                <HStack
                  border="1px solid"
                  borderColor="gray.200"
                  borderRadius="md"
                  paddingX={3}
                  paddingY={2}
                  bg="white"
                >
                  <Search size={16} color="gray" />
                  <Input
                    placeholder="Search prompts..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    variant="flushed"
                    size="sm"
                    border="none"
                    _focus={{ boxShadow: "none" }}
                    data-testid="prompt-search-input"
                  />
                </HStack>
              )}
            </VStack>

            {/* Prompt list - scrollable */}
            <VStack
              gap={2}
              align="stretch"
              flex={1}
              overflowY="auto"
              paddingX={6}
              paddingBottom={4}
            >
              {isLoading ? (
                <HStack justify="center" paddingY={8}>
                  <Spinner size="md" />
                </HStack>
              ) : !hasPrompts ? (
                <EmptyState onCreateNew={onCreateNew} />
              ) : filteredCount === 0 ? (
                <VStack paddingY={8} gap={2} textAlign="center">
                  <Text color="gray.500" data-testid="no-search-results">
                    No prompts match "{searchQuery}"
                  </Text>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearchQuery("")}
                  >
                    Clear search
                  </Button>
                </VStack>
              ) : (
                groupedPrompts.map(([folder, folderPrompts]) => (
                  <PromptFolder
                    key={folder}
                    folder={folder}
                    prompts={folderPrompts}
                    onSelect={handleSelectPrompt}
                  />
                ))
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <VStack paddingY={12} gap={4} textAlign="center">
      <Box padding={4} borderRadius="full" bg="gray.100" color="gray.500">
        <FileText size={32} />
      </Box>
      <VStack gap={1}>
        <Text fontWeight="medium" color="gray.700">
          No prompts yet
        </Text>
        <Text fontSize="sm" color="gray.500">
          Create your first prompt to get started
        </Text>
      </VStack>
      <Button
        colorPalette="blue"
        onClick={onCreateNew}
        data-testid="create-first-prompt-button"
      >
        <Plus size={16} />
        Create your first prompt
      </Button>
    </VStack>
  );
}

// ============================================================================
// Prompt Folder Component
// ============================================================================

type PromptFolderProps = {
  folder: string;
  prompts: Array<{
    id: string;
    handle: string | null;
    model: string | null;
    version: number;
  }>;
  onSelect: (prompt: { id: string; handle: string | null }) => void;
};

function PromptFolder({ folder, prompts, onSelect }: PromptFolderProps) {
  const [isOpen, setIsOpen] = useState(folder === "default");
  const isDefaultFolder = folder === "default";

  if (isDefaultFolder) {
    // Default folder (no folder prefix) - show prompts directly without collapsible
    return (
      <VStack gap={1} align="stretch">
        {prompts.map((prompt) => (
          <PromptCard
            key={prompt.id}
            prompt={prompt}
            onClick={() => onSelect(prompt)}
          />
        ))}
      </VStack>
    );
  }

  return (
    <Collapsible.Root
      open={isOpen}
      onOpenChange={({ open }) => setIsOpen(open)}
    >
      <Collapsible.Trigger asChild>
        <Button
          variant="ghost"
          width="full"
          justifyContent="flex-start"
          padding={2}
          height="auto"
          data-testid={`folder-${folder}`}
        >
          <HStack gap={2} width="full">
            <Box
              transform={isOpen ? "rotate(90deg)" : "rotate(0deg)"}
              transition="transform 0.2s"
            >
              <ChevronRight size={16} />
            </Box>
            <FolderOpen size={16} />
            <Text flex={1} textAlign="left" fontWeight="medium">
              {folder}
            </Text>
            <Text fontSize="xs" color="gray.500">
              ({prompts.length})
            </Text>
          </HStack>
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack gap={1} align="stretch" paddingLeft={6} paddingY={1}>
          {prompts.map((prompt) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              onClick={() => onSelect(prompt)}
            />
          ))}
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

// ============================================================================
// Prompt Card Component
// ============================================================================

type PromptCardProps = {
  prompt: {
    id: string;
    handle: string | null;
    model: string | null;
    version: number;
  };
  onClick: () => void;
};

function PromptCard({ prompt, onClick }: PromptCardProps) {
  const displayName = getDisplayHandle(prompt.handle);
  const modelProvider = prompt.model?.split("/")[0];
  const ModelIconComponent = modelProvider
    ? modelProviderIcons[modelProvider as keyof typeof modelProviderIcons]
    : null;

  const renderIcon = () => {
    if (ModelIconComponent && typeof ModelIconComponent === "function") {
      const Icon = ModelIconComponent as React.ComponentType<{ size?: number }>;
      return <Icon size={20} />;
    }
    return <FileText size={20} />;
  };

  return (
    <Box
      as="button"
      onClick={onClick}
      padding={3}
      borderRadius="md"
      border="1px solid"
      borderColor="gray.200"
      bg="white"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "blue.400", bg: "blue.50" }}
      transition="all 0.15s"
      data-testid={`prompt-card-${prompt.id}`}
    >
      <HStack gap={3}>
        <Box color="green.500">{renderIcon()}</Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontWeight="medium" fontSize="sm">
            {displayName}
          </Text>
          <HStack gap={2} fontSize="xs" color="gray.500">
            <Text>v{prompt.version}</Text>
            {prompt.model && (
              <>
                <Text>•</Text>
                <Text>{prompt.model}</Text>
              </>
            )}
          </HStack>
        </VStack>
      </HStack>
    </Box>
  );
}
