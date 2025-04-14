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

const DUMMY_VERSIONS_DATA = [
  {
    id: "1",
    version: "1",
    commitMessage: "My first version",
    createdAt: new Date("2021-01-01"),
    isCurrentVersion: true,
    author: {
      name: "John Doe",
    },
  },
];

export function VersionHistoryListPopover() {
  const { open, onToggle, onClose, setOpen } = useDisclosure();

  return (
    <Popover.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Popover.Trigger asChild>
        <Button variant="ghost" color="gray.500" size="xs" onClick={onToggle}>
          <HistoryIcon size={16} />
        </Button>
      </Popover.Trigger>
      {open && (
        <HistoryPopover
          onClose={onClose}
          onRestore={() => {}}
          versions={DUMMY_VERSIONS_DATA}
          onSubmit={() => {}}
          isLoading={false}
          nextVersion="1"
          canSaveNewVersion={false}
        />
      )}
    </Popover.Root>
  );
}

function HistoryPopover({
  onClose,
  onRestore,
  versions,
  onSubmit,
  isLoading,
  nextVersion,
  canSaveNewVersion,
}: {
  onClose: () => void;
  onRestore: (versionId: string) => void;
  nextVersion: string;
  canSaveNewVersion: boolean;
  versions: {
    id: string;
    version: string;
    commitMessage: string | null;
    createdAt: Date;
    isCurrentVersion: boolean;
    author: {
      name: string;
    };
  }[];
  onSubmit: (data: { version: string; commitMessage: string }) => void;
  isLoading: boolean;
}) {
  const form = useForm<{ version: string; commitMessage: string }>({
    defaultValues: {
      version: "",
      commitMessage: "",
    },
  });

  return (
    <Popover.Content width="500px">
      <Popover.Arrow />
      <Popover.Header fontWeight={600}>Workflow Versions</Popover.Header>
      <Popover.CloseTrigger />
      <Popover.Body padding={0}>
        <form
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onSubmit={form.handleSubmit(onSubmit)}
          style={{ width: "100%", padding: "20px" }}
        >
          <VStack align="start" width="full">
            <NewVersionFields
              form={form}
              nextVersion={nextVersion}
              canSaveNewVersion={canSaveNewVersion}
            />
            <Tooltip
              content={!canSaveNewVersion ? "No changes to save" : ""}
              positioning={{ placement: "top" }}
            >
              <Button
                type="submit"
                alignSelf="end"
                colorPalette="orange"
                size="sm"
                loading={isLoading}
              >
                Save new version
              </Button>
            </Tooltip>
          </VStack>
        </form>
        <Separator />
        <VStack
          align="start"
          width="full"
          padding={5}
          maxHeight="350px"
          overflowY="auto"
        >
          <Text fontWeight={600} fontSize="16px" paddingTop={2}>
            Previous Versions
          </Text>
          {versions.map((version) => (
            <VersionHistoryItem
              key={version.id}
              version={version}
              onRestore={onRestore}
              isLoading={isLoading}
            />
          ))}
        </VStack>
      </Popover.Body>
    </Popover.Content>
  );
}

export function VersionHistoryItem({
  version,
  onRestore,
  isLoading,
}: {
  version: {
    id: string;
    version: string;
    commitMessage: string | null;
    createdAt: Date;
    isCurrentVersion: boolean;
    author: {
      name: string;
    };
  };
  onRestore: (versionId: string) => void;
  isLoading: boolean;
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
            {version.isCurrentVersion && (
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
        {!version.isCurrentVersion && (
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
  version?: { autoSaved?: boolean; version: string };
} & BoxProps) => {
  return (
    <Box
      backgroundColor={version?.autoSaved ? "orange.50" : "orange.100"}
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
      {version?.autoSaved ? " " : version?.version}
      {children}
    </Box>
  );
};

export function NewVersionFields({
  form,
  nextVersion,
  canSaveNewVersion,
}: {
  form: UseFormReturn<{ version: string; commitMessage: string }>;
  nextVersion: string;
  canSaveNewVersion: boolean;
}) {
  return (
    <HStack width="full">
      <Field.Root width="fit-content" invalid={!!form.formState.errors.version}>
        <VStack align="start">
          <Field.Label as={SmallLabel} color="gray.600">
            Version
          </Field.Label>
          <Text>{nextVersion}</Text>
        </VStack>
      </Field.Root>
      <Field.Root width="full" invalid={!!form.formState.errors.commitMessage}>
        <VStack align="start" width="full">
          <Field.Label as={SmallLabel} color="gray.600">
            Description
          </Field.Label>
          <Input
            {...form.register("commitMessage", {
              required: true,
            })}
            placeholder="What changes have you made?"
            width="full"
            disabled={!canSaveNewVersion}
          />
        </VStack>
      </Field.Root>
    </HStack>
  );
}

export const VersionToBeUsed = ({
  form,
  nextVersion,
  canSaveNewVersion,
  versionToBeEvaluated,
}: {
  form: UseFormReturn<{ version: string; commitMessage: string }>;
  nextVersion: string;
  canSaveNewVersion: boolean;
  versionToBeEvaluated: {
    id: string | undefined;
    version: string | undefined;
    commitMessage: string | undefined;
  };
}) => {
  if (canSaveNewVersion) {
    return (
      <NewVersionFields
        form={form}
        nextVersion={nextVersion}
        canSaveNewVersion={canSaveNewVersion}
      />
    );
  }

  return (
    <HStack width="full">
      <VStack align="start">
        <SmallLabel color="gray.600">Version</SmallLabel>
        <Text width="74px">{versionToBeEvaluated.version}</Text>
      </VStack>
      <VStack align="start" width="full">
        <SmallLabel color="gray.600">Description</SmallLabel>
        <Text>{versionToBeEvaluated.commitMessage}</Text>
      </VStack>
    </HStack>
  );
};
