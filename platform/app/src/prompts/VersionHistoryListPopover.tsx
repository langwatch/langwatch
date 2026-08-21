import {
  Avatar,
  Box,
  Button,
  type ButtonProps,
  HStack,
  Spacer,
  Spinner,
  Tag,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { createLogger } from "@langwatch/observability";
import { MoreVertical } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { HistoryIcon } from "~/components/icons/History";
import { Menu } from "~/components/ui/menu";
import { Popover } from "~/components/ui/popover";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { VersionedPrompt } from "~/server/prompt-config";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import {
  diffPromptVersions,
  type PromptVersionSnapshot,
} from "./version-history/promptVersionDiff";
import { VersionChanges } from "./version-history/VersionChanges";

const logger = createLogger("VersionHistoryListPopover");

/**
 * The fields of a prompt version this panel reads: what the version says, when
 * it was written, by whom, and enough of its content to diff it against the
 * version before it.
 */
interface VersionHistoryItemData extends PromptVersionSnapshot {
  id: string;
  versionId: string;
  version: number;
  commitMessage?: string;
  versionCreatedAt?: Date | string | null;
  author?: {
    name: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
}

/**
 * When a version was written. Relative in the row because that is the question
 * ("is this recent?"); the exact moment is one hover away for the times it
 * matters.
 */
function VersionTimestamp({ createdAt }: { createdAt?: Date | string | null }) {
  if (!createdAt) return null;

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;

  const absolute = date.toLocaleString();

  return (
    <Tooltip content={absolute} positioning={{ placement: "top" }}>
      <Text
        fontSize="11px"
        color="fg.subtle"
        whiteSpace="nowrap"
        cursor="help"
        tabIndex={0}
        aria-label={`Saved ${absolute}`}
      >
        {formatTimeAgo(date.getTime())}
      </Text>
    </Tooltip>
  );
}

/**
 * Author line for a version: an avatar (SSO/OAuth photo → initials → generic
 * silhouette), the author's display name, and a tooltip revealing who it is.
 *
 * The name falls back to the author's email, then to "Unknown author", so the
 * row is never a bare, unlabelled icon. Versions created through the SDK/API
 * have no author on record; that is stated in the tooltip rather than left
 * blank (which previously rendered as a nameless silhouette with no hover).
 */
function VersionAuthor({
  author,
}: {
  author?: VersionHistoryItemData["author"];
}) {
  const [brokenImageUrl, setBrokenImageUrl] = useState<string | null>(null);

  const name = author?.name?.trim() ? author.name.trim() : null;
  const email = author?.email?.trim() ? author.email.trim() : null;
  const image = author?.image ?? null;

  const label = name ?? email ?? "Unknown author";
  const isKnown = Boolean(name ?? email);
  // OAuth/SSO image URLs can 404 or be CORS-blocked; fall back to initials
  // instead of the browser's broken-image glyph (see PresenceAvatar).
  const showImage = Boolean(image) && image !== brokenImageUrl;

  const tooltipContent = !author ? (
    "No author recorded for this version"
  ) : (
    <VStack gap={0} align="start">
      <Text fontWeight={600}>{name ?? email ?? "Unknown author"}</Text>
      {name && email && (
        <Text fontSize="11px" opacity={0.8}>
          {email}
        </Text>
      )}
    </VStack>
  );

  return (
    <Tooltip
      content={tooltipContent}
      positioning={{ placement: "top" }}
      showArrow
    >
      <HStack fontSize="12px" gap={1.5} minWidth={0} cursor="default">
        <Avatar.Root
          size="2xs"
          backgroundColor="orange.solid"
          color="white"
          width="16px"
          height="16px"
        >
          {showImage && image && (
            <Avatar.Image
              src={image}
              onError={() => setBrokenImageUrl(image)}
            />
          )}
          <Avatar.Fallback name={name ?? ""} fontSize="6.4px" />
        </Avatar.Root>
        <Text lineClamp={1} color={isKnown ? "fg.muted" : "fg.subtle"}>
          {label}
        </Text>
      </HStack>
    </Tooltip>
  );
}

/**
 * The row's identity line: which version, when it was saved, and the single
 * action the row offers, in the trailing cell per
 * dev/docs/best_practices/row-actions-overflow-menu.md.
 */
function VersionIdentityLine({
  data,
  isCurrent,
  onLoad,
}: {
  data: VersionHistoryItemData;
  isCurrent: boolean;
  onLoad: () => void;
}) {
  return (
    <HStack gap={2} width="full">
      <Text
        fontSize="11px"
        fontWeight={700}
        letterSpacing="0.04em"
        color="fg.muted"
        whiteSpace="nowrap"
      >
        v{data.version}
      </Text>
      {isCurrent && (
        <Tag.Root size="sm" colorPalette="blue" paddingX={2}>
          <Tag.Label fontSize="10px" letterSpacing="0.04em">
            Current
          </Tag.Label>
        </Tag.Root>
      )}
      <Spacer />
      <VersionTimestamp createdAt={data.versionCreatedAt} />
      {!isCurrent && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              minWidth={0}
              paddingX={1}
              aria-label={`Actions for version ${data.version}`}
              data-testid={`version-actions-button-${data.version}`}
            >
              <MoreVertical size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item
              value="load"
              data-testid={`restore-version-button-${data.version}`}
              onClick={(event) => {
                event.stopPropagation();
                onLoad();
              }}
            >
              Load this version
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      )}
    </HStack>
  );
}

/**
 * One version.
 *
 * Three lines, each with one job, so the eye can scan a column at a time:
 * which version and when (the identity line, with the row's action in its
 * trailing cell), what the author said they did (the loudest line, because it
 * is the reason to read the row at all), and who wrote it alongside the way in
 * to the diff.
 *
 * The version number is a quiet label rather than a tile: it identifies the
 * row, it does not deserve to be the first thing seen. The version the editor
 * currently holds is marked twice over — an accent down its leading edge and a
 * "Current" tag — because "which one am I on?" is the question a history is
 * opened to answer.
 */
function VersionHistoryItem({
  data,
  previous,
  onLoad,
  isCurrent,
}: {
  data: VersionHistoryItemData;
  /** The version saved before this one, when the history holds it. */
  previous?: VersionHistoryItemData;
  onLoad: () => void;
  isCurrent: boolean;
}) {
  const { open: isExpanded, onToggle } = useDisclosure();

  const changes = useMemo(
    () =>
      isExpanded && previous
        ? diffPromptVersions({ previous, version: data })
        : [],
    [isExpanded, previous, data],
  );

  return (
    <Box
      as="li"
      listStyleType="none"
      width="full"
      colorPalette="blue"
      background={isCurrent ? "bg.subtle" : "transparent"}
      borderBottomWidth="1px"
      borderBottomColor="border.muted"
      borderInlineStartWidth="2px"
      borderInlineStartColor={isCurrent ? "colorPalette.solid" : "transparent"}
      paddingInlineStart={4}
      paddingInlineEnd={3}
      paddingY={3}
      _hover={{ background: "bg.subtle" }}
      // The last row sits on the panel's own rounded edge; a rule there would
      // cut across it.
      _last={{ borderBottomWidth: 0 }}
    >
      <VStack align="stretch" gap={1.5} width="full">
        <VersionIdentityLine
          data={data}
          isCurrent={isCurrent}
          onLoad={onLoad}
        />

        <Text
          fontWeight={500}
          fontSize="13px"
          color={data.commitMessage ? "fg" : "fg.subtle"}
          wordBreak="break-word"
          // Generous enough that the 200-char message the save dialog allows
          // never clips; still bounds a pathological message set via the
          // API/SDK, which has no length limit.
          lineClamp={8}
        >
          {data.commitMessage ? data.commitMessage : "No description"}
        </Text>

        <HStack gap={2} width="full">
          <VersionAuthor author={data.author} />
          <Spacer />
          {previous && (
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              paddingX={1}
              onClick={onToggle}
              aria-expanded={isExpanded}
              data-testid={`version-changes-toggle-${data.version}`}
            >
              {isExpanded ? (
                <LuChevronUp size={12} />
              ) : (
                <LuChevronDown size={12} />
              )}
              What changed
            </Button>
          )}
        </HStack>

        {isExpanded && previous && (
          <Box
            paddingTop={1}
            data-testid={`version-changes-${data.version}`}
            width="full"
          >
            <VersionChanges changes={changes} />
          </Box>
        )}
      </VStack>
    </Box>
  );
}

/**
 * The unsaved edits sitting in the editor.
 *
 * These belong to the editor, not to any version in the list, so they get
 * their own strip above it rather than a button beside the version they happen
 * to be based on.
 */
function UnsavedChangesStrip({ onDiscard }: { onDiscard: () => void }) {
  return (
    <HStack
      gap={2}
      width="full"
      paddingInlineStart={4}
      paddingInlineEnd={3}
      paddingY={2}
      background="bg.subtle"
      borderBottomWidth="1px"
      borderBottomColor="border.muted"
    >
      <Text fontSize="12px" color="fg.muted">
        You have unsaved changes
      </Text>
      <Spacer />
      <Button
        size="xs"
        variant="ghost"
        colorPalette="red"
        onClick={onDiscard}
        data-testid="discard-local-changes-button"
      >
        Discard changes
      </Button>
    </HStack>
  );
}

/**
 * Scrollable list of version history items
 */
function VersionHistoryList({
  versions,
  onLoad,
  isLoading,
  currentVersionId,
}: {
  versions: VersionHistoryItemData[];
  onLoad: (params: { versionId: string }) => void;
  isLoading: boolean;
  /** The versionId of the version currently being edited. If not provided, defaults to latest (index 0). */
  currentVersionId?: string;
}) {
  if (isLoading) {
    return (
      <VStack align="center" width="full" padding={8} gap={3}>
        <Spinner size="md" />
        <Text fontSize="12px" color="fg.muted">
          Loading versions
        </Text>
      </VStack>
    );
  }

  if (versions.length === 0) {
    return (
      <VStack align="center" width="full" padding={8}>
        <Text fontSize="12px" color="fg.muted">
          This prompt has no saved versions yet
        </Text>
      </VStack>
    );
  }

  return (
    <VStack
      as="ul"
      align="stretch"
      gap={0}
      width="full"
      maxHeight="360px"
      overflowY="auto"
    >
      {versions.map((version, index) => {
        // If currentVersionId is provided, use it to determine which is current
        // Otherwise fall back to the first (latest) version
        const isCurrent = currentVersionId
          ? version.versionId === currentVersionId
          : index === 0;

        return (
          <VersionHistoryItem
            key={version.versionId}
            data={version}
            // The list is newest-first, so the version saved before this one
            // is the next entry down.
            previous={versions[index + 1]}
            onLoad={() => void onLoad({ versionId: version.versionId })}
            isCurrent={isCurrent}
          />
        );
      })}
    </VStack>
  );
}

/**
 * Trigger button for the version history popover
 */
function VersionHistoryTrigger({
  onClick,
  label,
  size = "sm",
}: {
  onClick?: () => void;
  label?: string;
  size?: ButtonProps["size"];
}) {
  return (
    <Popover.Trigger asChild onClick={onClick}>
      {/* Sized with the row it lives in — the unsized default stood a notch
          taller than everything beside it. */}
      <Button
        variant="ghost"
        size={size}
        color="fg.muted"
        minWidth={0}
        data-testid="version-history-button"
      >
        <HistoryIcon size={16} />
        {label && <Text>{label}</Text>}
      </Button>
    </Popover.Trigger>
  );
}

/**
 * Content of the version history popover
 */
function VersionHistoryContent({
  onLoad,
  versions,
  isLoading,
  hasUnsavedChanges,
  currentVersionId,
}: {
  onLoad: (params: { versionId: string }) => void;
  versions: VersionHistoryItemData[];
  isLoading: boolean;
  hasUnsavedChanges?: boolean;
  currentVersionId?: string;
}) {
  // Discarding reloads whichever version the editor is based on, which is the
  // marked one — the same version the list marks "Current".
  const currentVersion = currentVersionId
    ? versions.find((version) => version.versionId === currentVersionId)
    : versions[0];

  return (
    <Popover.Content width="420px" maxWidth="calc(100vw - 32px)">
      <Popover.Arrow />
      <Popover.Header
        fontWeight={600}
        fontSize="14px"
        paddingY={3}
        borderBottomWidth="1px"
        borderBottomColor="border.muted"
      >
        Version history
      </Popover.Header>
      <Popover.CloseTrigger />
      <Popover.Body padding={0}>
        {hasUnsavedChanges && currentVersion && (
          <UnsavedChangesStrip
            onDiscard={() => onLoad({ versionId: currentVersion.versionId })}
          />
        )}
        <VersionHistoryList
          versions={versions}
          onLoad={onLoad}
          isLoading={isLoading}
          currentVersionId={currentVersionId}
        />
      </Popover.Body>
    </Popover.Content>
  );
}

/**
 * Base popover component without API dependencies
 */
function VersionHistoryPopover({
  isOpen,
  onOpenChange,
  onLoad,
  versions,
  isLoading,
  hasUnsavedChanges,
  currentVersionId,
  label,
  triggerSize,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLoad: (params: { versionId: string }) => void;
  versions: VersionHistoryItemData[];
  isLoading: boolean;
  hasUnsavedChanges?: boolean;
  currentVersionId?: string;
  label?: string;
  triggerSize?: ButtonProps["size"];
}) {
  return (
    <Popover.Root open={isOpen} onOpenChange={({ open }) => onOpenChange(open)}>
      <VersionHistoryTrigger label={label} size={triggerSize} />
      {isOpen && (
        <VersionHistoryContent
          onLoad={onLoad}
          versions={versions}
          isLoading={isLoading}
          hasUnsavedChanges={hasUnsavedChanges}
          currentVersionId={currentVersionId}
        />
      )}
    </Popover.Root>
  );
}

/**
 * Fully composed version history popover with API integration
 */
export function VersionHistoryListPopover({
  configId,
  currentVersionId,
  onRestoreSuccess,
  hasUnsavedChanges,
  label,
  initialOpen,
  triggerSize,
}: {
  configId: string;
  /** The versionId of the version currently being edited. If not provided, defaults to latest. */
  currentVersionId?: string;
  onRestoreSuccess?: (prompt: VersionedPrompt) => Promise<void>;
  hasUnsavedChanges?: boolean;
  label?: string;
  /** When true the popover opens automatically on first render. */
  initialOpen?: boolean;
  /** Matches the button row the trigger sits in. */
  triggerSize?: ButtonProps["size"];
}) {
  const { open, setOpen, onClose } = useDisclosure();

  useEffect(() => {
    if (initialOpen) {
      setOpen(true);
    }
    // Only run on mount — intentionally omitting setOpen and initialOpen from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { project } = useOrganizationTeamProject();
  const { data: prompts = [], isLoading } =
    api.prompts.getAllVersionsForPrompt.useQuery(
      {
        idOrHandle: configId,
        projectId: project?.id ?? "",
      },
      {
        enabled: open && !!project?.id && !!configId,
      },
    );

  /**
   * Load version data into the form without creating a new version.
   * User will need to save manually to complete the restore.
   */
  const handleRestore = useCallback(
    (params: { versionId: string }) => {
      void (async () => {
        const { versionId } = params;

        // Find the version in the already-fetched data
        const prompt = prompts.find((p) => p.versionId === versionId);
        if (!prompt) {
          logger.error("Version not found in loaded data");
          toaster.error({
            title: "Failed to load version",
            description: "Version not found",
          });
          return;
        }

        try {
          await onRestoreSuccess?.(prompt);
          onClose();
          toaster.info({
            title: `Restored prompt to version ${prompt.version}`,
          });
        } catch (error) {
          logger.error({ error }, "Error loading version");
          showErrorToast({
            error,
            fallbackTitle: "Couldn't load this version",
          });
        }
      })();
    },
    [prompts, onRestoreSuccess, onClose],
  );

  return (
    <VersionHistoryPopover
      isOpen={open}
      onOpenChange={(open) => {
        setOpen(open);
      }}
      onLoad={handleRestore}
      versions={prompts}
      isLoading={isLoading}
      hasUnsavedChanges={hasUnsavedChanges}
      currentVersionId={currentVersionId}
      label={label}
      triggerSize={triggerSize}
    />
  );
}
