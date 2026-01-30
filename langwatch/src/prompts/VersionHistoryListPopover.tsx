import {
  Avatar,
  Box,
  type BoxProps,
  Button,
  HStack,
  Separator,
  Spacer,
  Tag,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useCallback } from "react";
import { LuChevronRight } from "react-icons/lu";
import { HistoryIcon } from "~/components/icons/History";
import { Popover } from "~/components/ui/popover";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { VersionedPrompt } from "~/server/prompt-config";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";

const logger = createLogger("VersionHistoryListPopover");

/**
 * Minimal interface for version history display
 * Contains only the fields actually used by the UI components
 */
interface VersionHistoryItemData {
  id: string;
  versionId: string;
  version: number;
  commitMessage?: string;
  author?: {
    name: string | null;
  } | null;
}

/**
 * Displays a version number in a styled box
 */
const VersionNumberBox = ({
  version,
  children,
  ...props
}: {
  version?: Pick<VersionHistoryItemData, "version">;
} & BoxProps) => {
  return (
    <Box
      backgroundColor="orange.subtle"
      paddingY={3}
      paddingX={2}
      borderRadius="lg"
      fontWeight={600}
      fontSize="13px"
      color="fg.muted"
      whiteSpace="nowrap"
      textAlign="center"
      minWidth="0px"
      height="44px"
      {...props}
    >
      {version?.version}
      {children}
    </Box>
  );
};

/**
 * Individual version history item showing commit message, author and restore button
 */
function VersionHistoryItem({
  data,
  onRestore,
  isLoading,
  isCurrent,
  hasUnsavedChanges,
}: {
  data: VersionHistoryItemData;
  onRestore: () => void;
  isLoading: boolean;
  isCurrent: boolean;
  hasUnsavedChanges?: boolean;
}) {
  return (
    <VStack width="full" align="start" paddingBottom={2}>
      <Separator marginBottom={2} />
      <HStack width="full" gap={3} align="start">
        <VersionNumberBox version={data} minWidth="48px" />
        <VStack align="start" width="full" gap={1}>
          <HStack width="full">
            <HStack gap={2} flex={1} minWidth={0}>
              <Text fontWeight={600} fontSize="13px" lineClamp={1}>
                {data.commitMessage}
              </Text>
              {isCurrent && (
                <Tag.Root
                  colorPalette="gray"
                  size="sm"
                  paddingX={2}
                  fontWeight="normal"
                >
                  <Tag.Label>current</Tag.Label>
                </Tag.Root>
              )}
            </HStack>
            <Spacer />
            {/* Discard changes button - reloads current version (same as "Load this version") */}
            {isCurrent && hasUnsavedChanges && (
              <Button
                size="xs"
                variant="outline"
                colorPalette="red"
                onClick={onRestore}
                loading={isLoading}
                data-testid="discard-local-changes-button"
                marginTop={1}
              >
                <HistoryIcon size={14} />
                Discard local changes
              </Button>
            )}
          </HStack>
          <HStack fontSize="12px">
            <Avatar.Root
              size="2xs"
              backgroundColor="orange.solid"
              color="white"
              width="16px"
              height="16px"
            >
              <Avatar.Fallback
                name={data.author?.name ?? ""}
                fontSize="6.4px"
              />
            </Avatar.Root>
            {data.author?.name}
          </HStack>
        </VStack>
        {!isCurrent && (
          <Tooltip
            content="Load this version"
            positioning={{ placement: "top" }}
          >
            <Button
              size="xs"
              data-testid={`restore-version-button-${data.version}`}
              variant="outline"
              onClick={onRestore}
              loading={isLoading}
            >
              Select this version
              <LuChevronRight size={14} />
            </Button>
          </Tooltip>
        )}
      </HStack>
    </VStack>
  );
}

/**
 * Scrollable list of version history items
 */
function VersionHistoryList({
  versions,
  onRestore,
  isLoading,
  hasUnsavedChanges,
  currentVersionId,
}: {
  versions: VersionHistoryItemData[];
  onRestore: (params: { versionId: string }) => void;
  isLoading: boolean;
  hasUnsavedChanges?: boolean;
  /** The versionId of the version currently being edited. If not provided, defaults to latest (index 0). */
  currentVersionId?: string;
}) {
  return (
    <VStack
      align="start"
      width="full"
      padding={5}
      maxHeight="350px"
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
            onRestore={() => void onRestore({ versionId: version.versionId })}
            isCurrent={isCurrent}
            isLoading={isLoading}
            hasUnsavedChanges={hasUnsavedChanges}
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
}: {
  onClick?: () => void;
  label?: string;
}) {
  return (
    <Popover.Trigger asChild onClick={onClick}>
      <Button
        variant="ghost"
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
  onRestore,
  versions,
  isLoading,
  hasUnsavedChanges,
  currentVersionId,
}: {
  onRestore: (params: { versionId: string }) => void;
  versions: VersionHistoryItemData[];
  isLoading: boolean;
  hasUnsavedChanges?: boolean;
  currentVersionId?: string;
}) {
  return (
    <Popover.Content width="500px">
      <Popover.Arrow />
      <Popover.Header fontWeight={600} fontSize="16px">
        Prompt Version History
      </Popover.Header>
      <Popover.CloseTrigger />
      <Popover.Body padding={0}>
        <VersionHistoryList
          versions={versions}
          onRestore={onRestore}
          isLoading={isLoading}
          hasUnsavedChanges={hasUnsavedChanges}
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
  onRestore,
  versions,
  isLoading,
  hasUnsavedChanges,
  currentVersionId,
  label,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (params: { versionId: string }) => void;
  versions: VersionHistoryItemData[];
  isLoading: boolean;
  hasUnsavedChanges?: boolean;
  currentVersionId?: string;
  label?: string;
}) {
  return (
    <Popover.Root open={isOpen} onOpenChange={({ open }) => onOpenChange(open)}>
      <VersionHistoryTrigger label={label} />
      {isOpen && (
        <VersionHistoryContent
          onRestore={onRestore}
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
}: {
  configId: string;
  /** The versionId of the version currently being edited. If not provided, defaults to latest. */
  currentVersionId?: string;
  onRestoreSuccess?: (prompt: VersionedPrompt) => Promise<void>;
  hasUnsavedChanges?: boolean;
  label?: string;
}) {
  const { open, setOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const { data: prompts = [], isLoading } =
    api.prompts.getAllVersionsForPrompt.useQuery(
      {
        idOrHandle: configId,
        projectId: project?.id ?? "",
      },
      {
        enabled: !!project?.id && !!configId,
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
            meta: {
              closable: true,
            },
          });
        } catch (error) {
          logger.error({ error }, "Error loading version");
          toaster.error({
            title: "Failed to load version",
            description:
              error instanceof Error ? error.message : "Unknown error",
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
      onRestore={handleRestore}
      versions={prompts}
      isLoading={isLoading}
      hasUnsavedChanges={hasUnsavedChanges}
      currentVersionId={currentVersionId}
      label={label}
    />
  );
}
