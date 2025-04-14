import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Separator,
  Tag,
  Text,
  VStack,
  type BoxProps,
  useDisclosure,
} from "@chakra-ui/react";
import { Avatar } from "@chakra-ui/react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { HistoryIcon } from "../icons/History";
import { SmallLabel } from "../SmallLabel";
import { Tooltip } from "../ui/tooltip";
import { Popover } from "../ui/popover";
import type { LlmPromptConfigVersion, User } from "@prisma/client";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

// Type for simplified User from API response
type AuthorUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

interface VersionHistoryListPopoverProps {
  configId: string;
  children: React.ReactNode;
}

export function VersionHistoryListPopover({
  configId,
  children,
}: VersionHistoryListPopoverProps) {
  const { open, onClose, setOpen } = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const {
    data: versions,
    isLoading,
    refetch,
  } = api.llmConfigs.versions.getVersions.useQuery(
    {
      configId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

  console.log({ versions, isLoading, configId, projectId: project?.id });

  const handleTriggerClick = () => {
    void refetch();
  };

  return (
    <Popover.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <VersionHistoryListPopoverTrigger onClick={handleTriggerClick} />
      {open && (
        <HistoryPopover
          onClose={onClose}
          onRestore={() => {
            // TODO: Implement restore
          }}
          versions={versions ?? []}
          onSubmit={() => {
            // TODO: Implement submit
          }}
          isLoading={false}
          nextVersion="1"
          canSaveNewVersion={false}
        />
      )}
    </Popover.Root>
  );
}

export function VersionHistoryListPopoverTrigger({
  children,
  onClick,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Popover.Trigger asChild onClick={onClick}>
      <Button variant="ghost" color="gray.500" size="xs">
        <HistoryIcon size={16} />
        <Text>Prompt Version History</Text>
      </Button>
    </Popover.Trigger>
  );
}

interface HistoryPopoverProps {
  onClose: () => void;
  onRestore: (versionId: string) => void;
  versions: (LlmPromptConfigVersion & { author: AuthorUser | null })[];
  onSubmit: (data: { version: string; commitMessage: string }) => void;
  isLoading: boolean;
  nextVersion: string;
  canSaveNewVersion: boolean;
}

function HistoryPopover({
  onClose,
  onRestore,
  versions,
  onSubmit,
  isLoading,
  nextVersion,
  canSaveNewVersion,
}: HistoryPopoverProps) {
  return (
    <Popover.Content width="500px">
      <Popover.Arrow />
      <Popover.Header fontWeight={600} fontSize="16px">
        Prompt Version History
      </Popover.Header>
      <Popover.CloseTrigger />
      <Popover.Body padding={0}>
        <VersionHistory versions={versions} />
      </Popover.Body>
    </Popover.Content>
  );
}

function VersionHistory({
  versions,
}: {
  versions: (LlmPromptConfigVersion & { author: AuthorUser | null })[];
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
          onRestore={() => {
            // TODO: Implement restore
          }}
          isCurrent={index === 0}
          isLoading={false}
        />
      ))}
    </VStack>
  );
}

export function VersionHistoryItem({
  version,
  onRestore,
  isLoading,
  isCurrent,
}: {
  version: LlmPromptConfigVersion & { author: AuthorUser | null };
  onRestore: (versionId: string) => void;
  isLoading: boolean;
  isCurrent: boolean;
}) {
  return (
    <VStack key={version.id} width="full" align="start" paddingBottom={2}>
      <Separator marginBottom={2} />
      <HStack width="full" gap={3}>
        <VersionBox version={version} minWidth="48px" />
        <VStack align="start" width="full" gap={1}>
          <HStack>
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
            {/* {" · "}
          <Tooltip
            // content={new Date(version.updatedAt).toLocaleString()}
            content="what"
            positioning={{ placement: "top" }}
          >
            {formatTimeAgo(version.updatedAt.getTime())}
          </Tooltip> */}
          </HStack>
        </VStack>
        {!isCurrent && (
          <Tooltip
            content="Restore this version"
            positioning={{ placement: "top" }}
          >
            <Button
              variant="ghost"
              onClick={() => void onRestore(version.id)}
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

export const VersionBox = ({
  version,
  children,
  ...props
}: {
  version?: LlmPromptConfigVersion;
} & BoxProps) => {
  return (
    <Box
      backgroundColor={"orange.100"}
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
