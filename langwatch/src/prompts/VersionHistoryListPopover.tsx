import {
  Avatar,
  Box,
  type BoxProps,
  Button,
  HStack,
  Separator,
  Tag,
  Text,
  Spacer,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useCallback } from "react";
import { HistoryIcon } from "~/components/icons/History";
import { Popover } from "~/components/ui/popover";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { VersionedPrompt } from "~/server/prompt-config";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import { usePrompts } from "./hooks";

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
      backgroundColor="orange.100"
      paddingY={3}
      paddingX={2}
      borderRadius="lg"
      fontWeight={600}
      fontSize="13px"
      color="gray.600"
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
  onDiscardChanges,
  isLoading,
  isCurrent,
  hasUnsavedChanges,
}: {
  data: VersionHistoryItemData;
  onRestore: () => void;
  onDiscardChanges?: () => void;
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
            <Text fontWeight={600} fontSize="13px" lineClamp={1}>
              {data.commitMessage}
              {isCurrent && (
                <Tag.Root colorPalette="green" size="sm" paddingX={2} marginLeft={2} marginTop="1px" fontWeight="normal">
                  <Tag.Label>current</Tag.Label>
                </Tag.Root>
              )}
            </Text>
            <Spacer />
            {/* Discard changes button for current version when there are unsaved changes */}
            {isCurrent && hasUnsavedChanges && onDiscardChanges && (
              <Button
                size="xs"
                variant="outline"
                colorPalette="red"
                onClick={onDiscardChanges}
                data-testid="discard-local-changes-button"
                marginTop={1}
              >
                Discard local changes
              </Button>
            )}
          </HStack>
          <HStack fontSize="12px">
            <Avatar.Root
              size="2xs"
              backgroundColor="orange.400"
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
            content="Restore this version"
            positioning={{ placement: "top" }}
          >
            <Button
              data-testid={`restore-version-button-${data.version}`}
              variant="ghost"
              onClick={onRestore}
              loading={isLoading}
            >
              <HistoryIcon size={24} />
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
  onDiscardChanges,
  isLoading,
  hasUnsavedChanges,
}: {
  versions: VersionHistoryItemData[];
  onRestore: (params: { versionId: string }) => void;
  onDiscardChanges?: () => void;
  isLoading: boolean;
  hasUnsavedChanges?: boolean;
}) {
  return (
    <VStack
      align="start"
      width="full"
      padding={5}
      maxHeight="350px"
      overflowY="auto"
    >
      {versions.map((version, index) => (
        <VersionHistoryItem
          key={version.versionId}
          data={version}
          onRestore={() => void onRestore({ versionId: version.versionId })}
          onDiscardChanges={onDiscardChanges}
          isCurrent={index === 0}
          isLoading={isLoading}
          hasUnsavedChanges={hasUnsavedChanges}
        />
      ))}
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
        color="gray.500"
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
  onDiscardChanges,
  versions,
  isLoading,
  hasUnsavedChanges,
}: {
  onRestore: (params: { versionId: string }) => void;
  onDiscardChanges?: () => void;
  versions: VersionHistoryItemData[];
  isLoading: boolean;
  hasUnsavedChanges?: boolean;
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
          onDiscardChanges={onDiscardChanges}
          isLoading={isLoading}
          hasUnsavedChanges={hasUnsavedChanges}
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
  onDiscardChanges,
  versions,
  isLoading,
  hasUnsavedChanges,
  label,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (params: { versionId: string }) => void;
  onDiscardChanges?: () => void;
  versions: VersionHistoryItemData[];
  isLoading: boolean;
  hasUnsavedChanges?: boolean;
  label?: string;
}) {
  return (
    <Popover.Root open={isOpen} onOpenChange={({ open }) => onOpenChange(open)}>
      <VersionHistoryTrigger label={label} />
      {isOpen && (
        <VersionHistoryContent
          onRestore={onRestore}
          onDiscardChanges={onDiscardChanges}
          versions={versions}
          isLoading={isLoading}
          hasUnsavedChanges={hasUnsavedChanges}
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
  onRestoreSuccess,
  onDiscardChanges,
  hasUnsavedChanges,
  label,
}: {
  configId: string;
  onRestoreSuccess?: (prompt: VersionedPrompt) => Promise<void>;
  onDiscardChanges?: () => void;
  hasUnsavedChanges?: boolean;
  label?: string;
}) {
  const { open, setOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const { restoreVersion } = usePrompts();
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

  const handleRestore = useCallback(
    (params: { versionId: string }) => {
      void (async () => {
        if (!project?.id) {
          logger.error("Cannot restore version: project not loaded");
          toaster.error({
            title: "Failed to restore version",
            description: "Project information is not available",
          });
          return;
        }
        const { versionId } = params;
        try {
          const prompt = await restoreVersion({
            versionId,
            projectId: project?.id ?? "",
          });
          await onRestoreSuccess?.(prompt);
          onClose();
          toaster.success({
            title: "Version restored successfully",
          });
        } catch (error) {
          logger.error({ error }, "Error restoring version");
          toaster.error({
            title: "Failed to restore version",
            description:
              error instanceof Error ? error.message : "Unknown error",
          });
        }
      })();
    },
    [restoreVersion, onRestoreSuccess, onClose, project?.id],
  );

  const handleDiscardChanges = useCallback(() => {
    onDiscardChanges?.();
    onClose();
  }, [onDiscardChanges, onClose]);

  return (
    <VersionHistoryPopover
      isOpen={open}
      onOpenChange={(open) => {
        setOpen(open);
      }}
      onRestore={handleRestore}
      onDiscardChanges={handleDiscardChanges}
      versions={prompts}
      isLoading={isLoading}
      hasUnsavedChanges={hasUnsavedChanges}
      label={label}
    />
  );
}
