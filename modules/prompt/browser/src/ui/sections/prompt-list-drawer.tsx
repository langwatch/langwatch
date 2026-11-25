import { getComplexProps, getFlowCallbacks, useDrawer } from "@langwatch/browser-host/drawer";
/**
 * "Choose prompt": the picker every flow opens, a REGISTERED drawer
 * belonging to the family that owns prompts. KNOWN GAP: "New Prompt"
 * still asks for `promptEditor`, whose own navigation isn't wired here yet.
 */
import { Drawer } from "@langwatch/design-system/drawer";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Box,
  Button,
  Collapsible,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { modelProviderIcons } from "@langwatch/design-system/provider-icons";
import { SearchInput } from "@langwatch/design-system/search-input";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { useProductAccent } from "@langwatch/design-system/use-product-accent";
import {
  PromptEditorDrawerToken,
  PromptListDrawerToken,
  type PromptListDrawerProps,
} from "@langwatch/prompt-client";
import groupBy from "lodash-es/groupBy";
import { ChevronRight, FileText, FolderOpen, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { useAllPromptsForProject } from "../../behavior/use-all-prompts-for-project.ts";
import { getDisplayHandle } from "../../prompt-reference.ts";

export type { PromptListDrawerProps };

/**
 * Drawer for selecting an existing prompt or creating a new one: saved
 * prompts grouped by folder (collapsible), empty state with create CTA,
 * "+ New Prompt" at top.
 */
export function PromptListDrawer(props: PromptListDrawerProps) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const flowCallbacks = getFlowCallbacks(PromptListDrawerToken);

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (flowCallbacks?.onSelect as PromptListDrawerProps["onSelect"]) ??
    (complexProps.onSelect as PromptListDrawerProps["onSelect"]);
  // Use flowCallbacks.onCreateNew if available (for evaluations context with availableSources)
  const onCreateNew =
    props.onCreateNew ??
    (flowCallbacks?.onCreateNew as PromptListDrawerProps["onCreateNew"]) ??
    (() => openDrawer(PromptEditorDrawerToken));
  const isOpen = props.open !== false && props.open !== undefined;

  const { data: prompts, isLoading } = useAllPromptsForProject();
  const [searchQuery, setSearchQuery] = useState("");

  // Filter and group prompts by folder (derived from handle prefix)
  const { groupedPrompts, hasPrompts, filteredCount } = useMemo(() => {
    const publishedPrompts = prompts?.filter((prompt) => prompt.version > 0) ?? [];

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
    const sortedGroups = Object.entries(grouped).toSorted((a, b) => {
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

  const handleSelectPrompt = (prompt: { id: string; handle: string | null }) => {
    // Find the full prompt data to get inputs/outputs
    const fullPrompt = prompts?.find((p) => p.id === prompt.id);

    // Call onSelect and let the callback handle navigation if needed.
    // Don't call onClose() here - the callback may navigate to another drawer,
    // and closeDrawer would wipe the flow callbacks.
    // If the callback doesn't navigate, the drawer will remain open but
    // that's the expected behavior for selection-then-edit flows.
    onSelect?.({
      id: prompt.id,
      name: prompt.handle ?? "New Prompt",
      version: fullPrompt?.version,
      versionId: fullPrompt?.versionId,
      inputs: fullPrompt?.inputs,
      outputs: fullPrompt?.outputs,
    });
  };

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      onBack={canGoBack ? goBack : void 0}
      backButtonTestId="back-button"
      size="md"
      title="Choose prompt"
      headerAction={{
        label: "New Prompt",
        icon: <Plus size={14} />,
        onClick: onCreateNew,
        "data-testid": "new-prompt-button",
      }}
      toolbar={
        hasPrompts ? (
          <SearchInput
            placeholder="Search prompts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="prompt-search-input"
          />
        ) : (
          void 0
        )
      }
      footer={{ cancel: { onClick: onClose } }}
    >
      <VStack gap={4} align="stretch">
        <Text color="fg.muted" fontSize="sm">
          Select an existing prompt or create a new one.
        </Text>
        <VStack gap={2} align="stretch">
          {isLoading && <SkeletonRows rows={5} />}
          {!isLoading && !hasPrompts && <EmptyState onCreateNew={onCreateNew} />}
          {!isLoading && hasPrompts && filteredCount === 0 && (
            <VStack paddingY={8} gap={2} textAlign="center">
              <Text color="fg.muted" data-testid="no-search-results">
                No prompts match "{searchQuery}"
              </Text>
              <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
                Clear search
              </Button>
            </VStack>
          )}
          {!isLoading &&
            hasPrompts &&
            filteredCount > 0 &&
            groupedPrompts.map(([folder, folderPrompts]) => (
              <PromptFolder
                key={folder}
                folder={folder}
                prompts={folderPrompts}
                onSelect={handleSelectPrompt}
              />
            ))}
        </VStack>
      </VStack>
    </Drawer>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  const accent = useProductAccent();
  return (
    <NoDataInfoBlock
      size="inline"
      bordered={false}
      icon={<FileText size={24} />}
      title="No prompts yet"
      description="Create your first prompt to get started"
      primaryAction={
        <Button
          colorPalette={accent.colorPalette}
          variant="solid"
          onClick={onCreateNew}
          data-testid="create-first-prompt-button"
        >
          <Plus size={16} />
          Create your first prompt
        </Button>
      }
      next={[
        {
          kind: "docs",
          label: "Prompt management",
          href: "https://docs.langwatch.ai/prompt-management/overview",
        },
      ]}
    />
  );
}

// ============================================================================
// Prompt Folder Component
// ============================================================================

type PromptFolderProps = {
  folder: string;
  prompts: {
    id: string;
    handle: string | null;
    model: string | null;
    version: number;
  }[];
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
          <PromptCard key={prompt.id} prompt={prompt} onClick={() => onSelect(prompt)} />
        ))}
      </VStack>
    );
  }

  return (
    <Collapsible.Root open={isOpen} onOpenChange={({ open }) => setIsOpen(open)}>
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
            <Box transform={isOpen ? "rotate(90deg)" : "rotate(0deg)"} transition="transform 0.2s">
              <ChevronRight size={16} />
            </Box>
            <FolderOpen size={16} />
            <Text flex={1} textAlign="left" fontWeight="medium">
              {folder}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              ({prompts.length})
            </Text>
          </HStack>
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack gap={1} align="stretch" paddingLeft={6} paddingY={1}>
          {prompts.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} onClick={() => onSelect(prompt)} />
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
      borderColor="border"
      bg="bg.panel"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "blue.muted", bg: "blue.subtle" }}
      transition="all 0.15s"
      data-testid={`prompt-card-${prompt.id}`}
    >
      <HStack gap={3}>
        <Box color="green.fg">{renderIcon()}</Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontWeight="medium" fontSize="sm">
            {displayName}
          </Text>
          <HStack gap={2} fontSize="xs" color="fg.muted">
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
