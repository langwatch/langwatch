import {
  Box,
  HStack,
  IconButton,
  Input,
  Skeleton,
  SkeletonCircle,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Search, X } from "lucide-react";
import { type DragEvent, useCallback, useMemo, useState } from "react";
import { ProviderIconGlyph } from "~/components/modelProviders/iconsMap";
import { InputGroup } from "~/components/ui/input-group";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { promptContextChip } from "~/features/langy/logic/langyContextChips";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { usePrompts } from "~/prompts/hooks/usePrompts";
import type { modelProviders } from "~/server/modelProviders/registry";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { useOpenPromptInPlayground } from "../../hooks/useOpenPromptInPlayground";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { activePromptId } from "./activePromptId";
import { PublishedPromptContent } from "./PublishedPromptContent";
import {
  groupPromptsForRail,
  matchesPromptRailFilter,
  movePromptHandleToFolder,
} from "./promptRail";
import { Sidebar } from "./ui/Sidebar";
import { SidebarEmptyState } from "./ui/SidebarEmptyState";

const DRAGGED_PROMPT_TYPE = "application/x-langwatch-prompt";

/** A compact loading state with the same icon, title and metadata rhythm as a row. */
function PromptRailSkeleton() {
  return (
    <Sidebar.List>
      {[1, 2, 3, 4].map((index) => (
        <Sidebar.Item key={index} pointerEvents="none">
          <HStack width="full" gap={2}>
            <SkeletonCircle size="16px" flexShrink={0} />
            <VStack align="stretch" gap={1} flex={1}>
              <Skeleton
                width={index % 2 === 0 ? "72%" : "58%"}
                height="10px"
                borderRadius="full"
              />
              <Skeleton width="34%" height="7px" borderRadius="full" />
            </VStack>
          </HStack>
        </Sidebar.Item>
      ))}
    </Sidebar.List>
  );
}

/**
 * How a folder shows that a dragged row would land in it. Kept apart from the
 * group's markup so the three props move together and read as one state.
 */
function dropTargetStyle(isDropTarget: boolean) {
  return isDropTarget
    ? {
        background: "blue.subtle",
        outline: "1px solid",
        outlineColor: "blue.muted",
      }
    : { background: "transparent" };
}

/**
 * One prompt in the rail. Split out from the folder group so the group reads
 * as the drop target it is, rather than as a drop target wrapped around a
 * whole row's worth of drag plumbing.
 */
function PromptRailRow({
  prompt,
  active,
  moving,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  prompt: VersionedPrompt;
  active: boolean;
  moving: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  return (
    <LangyContextTarget
      target={promptContextChip({
        promptId: prompt.id,
        handle: prompt.handle,
      })}
    >
      <Sidebar.Item
        active={active}
        icon={
          <ProviderIconGlyph
            provider={
              prompt.model?.split("/")[0] as keyof typeof modelProviders
            }
            size="16px"
          />
        }
        draggable
        opacity={moving ? 0.45 : 1}
        cursor={dragging ? "grabbing" : "grab"}
        onDragStart={(event: DragEvent<HTMLDivElement>) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(DRAGGED_PROMPT_TYPE, prompt.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onClick={onOpen}
      >
        <PublishedPromptContent
          promptId={prompt.id}
          promptHandle={prompt.handle}
          prompt={prompt}
        />
      </Sidebar.Item>
    </LangyContextTarget>
  );
}

/**
 * The project's prompt catalogue. Folder membership is the handle prefix, so
 * dropping a row onto a folder uses the existing handle update API and does
 * not introduce a second, drifting folder model.
 */
export function PublishedPromptsList() {
  const { data, isLoading } = useAllPromptsForProject();
  const selectedPromptId = useDraggableTabsBrowserStore(activePromptId);
  const { project } = useOrganizationTeamProject();
  const { updateHandle } = usePrompts();
  const [query, setQuery] = useState("");
  const [draggedPromptId, setDraggedPromptId] = useState<string>();
  const [dropFolder, setDropFolder] = useState<string | undefined | null>(null);
  const [movingPromptId, setMovingPromptId] = useState<string>();
  const openPrompt = useOpenPromptInPlayground();

  const prompts = useMemo(
    () => (data ?? []).filter((prompt) => prompt.version > 0),
    [data],
  );
  const visiblePrompts = useMemo(
    () =>
      prompts.filter((prompt) =>
        matchesPromptRailFilter({ prompt, rawQuery: query }),
      ),
    [prompts, query],
  );
  const groups = useMemo(
    () => groupPromptsForRail(visiblePrompts),
    [visiblePrompts],
  );

  const movePrompt = useCallback(
    async ({
      prompt,
      folder,
    }: {
      prompt: VersionedPrompt;
      folder?: string;
    }) => {
      if (!project?.id || !prompt.handle) return;
      const handle = movePromptHandleToFolder({
        handle: prompt.handle,
        folder,
      });
      if (handle === prompt.handle) return;

      setMovingPromptId(prompt.id);
      try {
        await updateHandle({
          projectId: project.id,
          id: prompt.id,
          data: { handle, scope: prompt.scope },
        });
        toaster.create({
          title: folder ? `Moved to ${folder}` : "Moved out of folder",
          description: handle,
          type: "success",
        });
      } catch (error) {
        showErrorToast({
          error,
          fallbackTitle: "Couldn't move the prompt",
        });
      } finally {
        setMovingPromptId(undefined);
      }
    },
    [project?.id, updateHandle],
  );

  const handleDrop = useCallback(
    ({ event, folder }: { event: DragEvent; folder?: string }) => {
      event.preventDefault();
      const promptId =
        event.dataTransfer.getData(DRAGGED_PROMPT_TYPE) || draggedPromptId;
      const prompt = prompts.find((candidate) => candidate.id === promptId);
      setDraggedPromptId(undefined);
      setDropFolder(null);
      if (prompt) void movePrompt({ prompt, folder });
    },
    [draggedPromptId, movePrompt, prompts],
  );

  if (isLoading) return <PromptRailSkeleton />;
  if (prompts.length === 0) return <SidebarEmptyState />;

  return (
    <VStack align="stretch" gap={2} paddingBottom={2}>
      <HStack paddingX={2} paddingY={1} gap={1.5}>
        <InputGroup
          startElement={<Search size={13} />}
          startOffset="0px"
          flex={1}
        >
          <Input
            size="xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter prompts"
            aria-label="Filter prompts"
            background="bg.panel"
          />
        </InputGroup>
        {query && (
          <IconButton
            aria-label="Clear prompt filter"
            size="xs"
            variant="ghost"
            onClick={() => setQuery("")}
          >
            <X size={13} />
          </IconButton>
        )}
      </HStack>

      {groups.length === 0 ? (
        <VStack paddingX={4} paddingY={7} gap={1} textAlign="center">
          <Text fontSize="sm" fontWeight="medium">
            No matching prompts
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Try a handle, model, author or live tag.
          </Text>
        </VStack>
      ) : (
        groups.map(({ folder, prompts: groupPrompts }) => {
          const isDropTarget = Boolean(
            dropFolder === folder && draggedPromptId,
          );
          return (
            <Box
              key={folder ?? "unfiled"}
              borderRadius="md"
              {...dropTargetStyle(isDropTarget)}
              transition="background 0.15s ease"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropFolder(folder);
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
                  setDropFolder(null);
                }
              }}
              onDrop={(event) => handleDrop({ event, folder })}
            >
              <Sidebar.List
                title={folder ?? "Unfiled"}
                collapsible
                defaultOpen
                action={
                  <Text textStyle="2xs" color="fg.subtle">
                    {groupPrompts.length}
                  </Text>
                }
              >
                {groupPrompts.map((prompt) => (
                  <PromptRailRow
                    key={prompt.id}
                    prompt={prompt}
                    active={prompt.id === selectedPromptId}
                    moving={movingPromptId === prompt.id}
                    dragging={draggedPromptId === prompt.id}
                    onDragStart={() => setDraggedPromptId(prompt.id)}
                    onDragEnd={() => {
                      setDraggedPromptId(undefined);
                      setDropFolder(null);
                    }}
                    onOpen={() => openPrompt(prompt)}
                  />
                ))}
              </Sidebar.List>
            </Box>
          );
        })
      )}
    </VStack>
  );
}
