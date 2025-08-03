import {
  Box,
  Button,
  HStack,
  Separator,
  Tag,
  Text,
  VStack,
  type BoxProps,
  useDisclosure,
} from "@chakra-ui/react";
import { Avatar } from "@chakra-ui/react";
import type { LlmPromptConfigVersion } from "@prisma/client";

import { HistoryIcon } from "~/components/icons/History";
import { Popover } from "~/components/ui/popover";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type AuthorUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

type PromptVersion = LlmPromptConfigVersion & { author: AuthorUser | null };

/**
 * Displays a version number in a styled box
 */
const VersionNumberBox = ({
  version,
  children,
  ...props
}: {
  version?: LlmPromptConfigVersion;
} & BoxProps) => {
  return (
    <Box
      backgroundColor="orange.100"
      paddingY={3}
      paddingX={2}
      borderRadius={4}
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
  version,
  onRestore,
  isLoading,
  isCurrent,
}: {
  version: PromptVersion;
  onRestore: () => void;
  isLoading: boolean;
  isCurrent: boolean;
}) {
  return (
    <VStack width="full" align="start" paddingBottom={2}>
      <Separator marginBottom={2} />
      <HStack width="full" gap={3}>
        <VersionNumberBox version={version} minWidth="48px" />
        <VStack align="start" width="full" gap={1}>
          <HStack width="full" justify="space-between">
            <Text fontWeight={600} fontSize="13px" lineClamp={1}>
              {version.commitMessage}
            </Text>
            {isCurrent && (
              <Tag.Root colorPalette="green" size="sm" paddingX={2}>
                <Tag.Label>current</Tag.Label>
              </Tag.Root>
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
                name={version.author?.name ?? ""}
                fontSize="6.4px"
              />
            </Avatar.Root>
            {version.author?.name}
          </HStack>
        </VStack>
        {!isCurrent && (
          <Tooltip
            content="Restore this version"
            positioning={{ placement: "top" }}
          >
            <Button
              data-testid={`restore-version-button-${version.version}`}
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
  isLoading,
}: {
  versions: PromptVersion[];
  onRestore: (versionId: string) => void;
  isLoading: boolean;
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
          key={version.id}
          version={version}
          onRestore={() => onRestore(version.id)}
          isCurrent={index === 0}
          isLoading={isLoading}
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
}: {
  onRestore: (versionId: string) => void;
  versions: PromptVersion[];
  isLoading: boolean;
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
  label,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (versionId: string) => void;
  versions: PromptVersion[];
  isLoading: boolean;
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
  onRestore,
  label,
}: {
  configId: string;
  onRestore?: (versionId: string) => void;
  label?: string;
}) {
  const { open, setOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const {
    data: versions,
    isLoading,
    refetch,
  } = api.llmConfigs.versions.getVersionsForConfigById.useQuery(
    {
      configId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );
  const { refetch: refetchPromptConfig } =
    api.llmConfigs.getByIdWithLatestVersion.useQuery(
      {
        id: configId,
        projectId: project?.id ?? "",
      },
      { enabled: !!project?.id }
    );
  const { mutateAsync: restoreVersion } =
    api.llmConfigs.versions.restore.useMutation();

  const handleRestore = async (versionId: string) => {
    try {
      await restoreVersion({
        id: versionId,
        projectId: project?.id ?? "",
      });
      await refetch();
      await refetchPromptConfig();
      onClose();
      onRestore?.(versionId);
      toaster.success({
        title: "Version restored successfully",
      });
    } catch (error) {
      console.error("Error restoring version", error);
      toaster.error({
        title: "Failed to restore version",
      });
    }
  };

  return (
    <VersionHistoryPopover
      isOpen={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) {
          void refetch();
        }
      }}
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRestore={handleRestore}
      versions={versions ?? []}
      isLoading={isLoading}
      label={label}
    />
  );
}
