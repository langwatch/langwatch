import {
  Box,
  Button,
  createListCollection,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Info } from "react-feather";
import { UnplugIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CopyButton } from "~/components/CopyButton";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { GeneratePromptApiSnippetDialog } from "~/prompts/components/GeneratePromptApiSnippetDialog";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";
import { Select } from "~/components/ui/select";
import { toaster } from "~/components/ui/toaster";
import { VALID_LABELS } from "~/prompts/constants/labels";
import { api } from "~/utils/api";

interface DeployPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  configId: string;
  handle: string;
  projectId: string;
}

/**
 * DeployPromptDialog
 *
 * Dialog for assigning prompt versions to environment labels (production, staging).
 * The "latest" label is auto-managed and always points to the highest version number.
 */
export function DeployPromptDialog({
  isOpen,
  onClose,
  configId,
  handle,
  projectId,
}: DeployPromptDialogProps) {
  const { project } = useOrganizationTeamProject();

  const versionsQuery = api.prompts.getAllVersionsForPrompt.useQuery(
    { idOrHandle: configId, projectId },
    { enabled: isOpen && !!configId && !!projectId },
  );

  const labelsQuery = api.prompts.getLabelsForConfig.useQuery(
    { configId, projectId },
    { enabled: isOpen && !!configId && !!projectId },
  );

  const assignLabel = api.prompts.assignLabel.useMutation();
  const utils = api.useContext();

  const versions = versionsQuery.data ?? [];

  const latestVersion = versions.reduce<typeof versions[number] | null>(
    (max, v) => (!max || v.version > max.version ? v : max),
    null,
  );

  type LabelSelections = Record<string, string>;
  const [labelSelections, setLabelSelections] = useState<LabelSelections>(
    () => Object.fromEntries(VALID_LABELS.map((l) => [l, ""])),
  );

  const setLabelVersionId = useCallback((label: string, versionId: string) => {
    setLabelSelections((prev) => ({ ...prev, [label]: versionId }));
  }, []);

  // Initialize selections from current label assignments
  useEffect(() => {
    if (!isOpen) return;
    const data = labelsQuery.data;
    if (!data?.length) {
      setLabelSelections(Object.fromEntries(VALID_LABELS.map((l) => [l, ""])));
      return;
    }

    const next: LabelSelections = {};
    for (const label of VALID_LABELS) {
      const found = data.find((l) => l.label === label);
      next[label] = found?.versionId ?? "";
    }
    setLabelSelections(next);
  }, [isOpen, labelsQuery.data]);

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const data = labelsQuery.data ?? [];

    const mutations: Promise<unknown>[] = [];

    for (const label of VALID_LABELS) {
      const selectedVersionId = labelSelections[label] ?? "";
      const currentLabel = data.find((l) => l.label === label);
      if (selectedVersionId && selectedVersionId !== (currentLabel?.versionId ?? "")) {
        mutations.push(
          assignLabel.mutateAsync({
            projectId,
            configId,
            versionId: selectedVersionId,
            label,
          }),
        );
      }
    }

    if (mutations.length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      await Promise.all(mutations);
      await utils.prompts.getLabelsForConfig.invalidate({ configId, projectId });
      toaster.create({
        title: "Labels saved",
        type: "success",
        duration: 2000,
        meta: { closable: true },
      });
      onClose();
    } catch {
      toaster.create({
        title: "Failed to save labels",
        type: "error",
        duration: 3000,
        meta: { closable: true },
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    labelsQuery.data,
    labelSelections,
    assignLabel,
    projectId,
    configId,
    onClose,
    utils,
  ]);

  const versionItems = useMemo(
    () =>
      [...versions]
        .sort((a, b) => b.version - a.version)
        .map((v) => ({
          label: `v${v.version}: ${v.commitMessage ?? "No message"}`,
          value: v.versionId,
          version: v.version,
          commitMessage: v.commitMessage ?? "No message",
        })),
    [versions],
  );

  const versionCollection = useMemo(
    () => createListCollection({ items: versionItems }),
    [versionItems],
  );

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(e) => !e.open && onClose()}
      size="md"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deploy prompt</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.muted">
              Use labels to get specific prompt versions via the SDK and API.
              Prompt versions with the production label are returned by default.
            </Text>

            <HStack gap={2}>
              <Box
                borderWidth="1px"
                borderColor="border"
                borderRadius="full"
                paddingX={3}
                paddingY={1}
              >
                <HStack gap={2}>
                  <Text fontSize="sm" color="fg.muted">
                    Slug:
                  </Text>
                  <Text fontSize="sm" fontWeight="medium">
                    {handle}
                  </Text>
                  <CopyButton value={handle} label="Prompt slug" />
                </HStack>
              </Box>
            </HStack>

            {/* Label rows */}
            <VStack align="stretch" gap={3}>
              {/* latest row — auto-managed, not editable */}
              <Box
                borderWidth="1px"
                borderColor="border"
                borderRadius="lg"
                paddingX={4}
                paddingY={3}
              >
                <HStack justify="space-between">
                  <HStack gap={3}>
                    <Box
                      width="10px"
                      height="10px"
                      borderRadius="full"
                      bg="green.400"
                      flexShrink={0}
                    />
                    <Text fontWeight="medium" fontSize="sm">
                      latest
                    </Text>
                  </HStack>
                  <HStack gap={2}>
                    <Text fontSize="sm" color="fg.muted" data-testid="latest-version">
                      {latestVersion ? `v${latestVersion.version}` : "--"}
                    </Text>
                    <Tooltip content="Automatically points to the latest version number.">
                      <Box color="fg.muted" cursor="help">
                        <Info size={14} />
                      </Box>
                    </Tooltip>
                  </HStack>
                </HStack>
              </Box>

              {/* Environment label rows */}
              {VALID_LABELS.map((label) => {
                const isAssigned = !!(labelSelections[label]);
                return (
                  <Box
                    key={label}
                    borderWidth="1px"
                    borderColor="border"
                    borderRadius="lg"
                    paddingX={4}
                    paddingY={3}
                  >
                    <HStack justify="space-between">
                      <HStack gap={3}>
                        <Box
                          width="10px"
                          height="10px"
                          borderRadius="full"
                          bg={isAssigned ? "green.400" : "gray.300"}
                          flexShrink={0}
                        />
                        <Text fontWeight="medium" fontSize="sm">
                          {label}
                        </Text>
                      </HStack>
                      <HStack gap={2}>
                      <Select.Root
                        collection={versionCollection}
                        size="sm"
                        width="auto"
                        minWidth="180px"
                        value={labelSelections[label] ? [labelSelections[label]!] : []}
                        onValueChange={(details) => {
                          setLabelVersionId(label, details.value[0] ?? "");
                        }}
                        aria-label={`${label.charAt(0).toUpperCase()}${label.slice(1)} version`}
                      >
                        <Select.Trigger clearable>
                          <Select.ValueText placeholder="Select version">
                            {(items) => {
                              const item = items[0] as typeof versionItems[number] | undefined;
                              if (!item) return "Select version";
                              return (
                                <HStack gap={1} maxWidth="100%" overflow="hidden">
                                  <Text as="span" fontFamily="mono" fontSize="sm" fontWeight="semibold" flexShrink={0}>
                                    v{item.version}
                                  </Text>
                                  <Text as="span" fontSize="sm" color="fg.muted" truncate>
                                    {item.commitMessage}
                                  </Text>
                                </HStack>
                              );
                            }}
                          </Select.ValueText>
                        </Select.Trigger>
                        <Select.Content>
                          {versionItems.map((v) => (
                            <Select.Item key={v.value} item={v}>
                              <Tooltip content={v.commitMessage} openDelay={500}>
                                <HStack gap={2} maxWidth="100%" overflow="hidden">
                                  <Text as="span" fontFamily="mono" fontSize="sm" fontWeight="semibold" flexShrink={0}>
                                    v{v.version}
                                  </Text>
                                  <Text as="span" fontSize="sm" color="fg.muted" truncate>
                                    {v.commitMessage}
                                  </Text>
                                </HStack>
                              </Tooltip>
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <GeneratePromptApiSnippetDialog
                        promptHandle={handle}
                        apiKey={project?.apiKey}
                        label={label}
                      >
                        <GeneratePromptApiSnippetDialog.Trigger>
                          <IconButton
                            variant="ghost"
                            size="xs"
                            aria-label="View code snippet"
                            css={{ boxShadow: "none !important" }}
                          >
                            <UnplugIcon size={14} />
                          </IconButton>
                        </GeneratePromptApiSnippetDialog.Trigger>
                      </GeneratePromptApiSnippetDialog>
                      </HStack>
                    </HStack>
                  </Box>
                );
              })}
            </VStack>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              size="sm"
              onClick={() => void handleSave()}
              loading={isSaving}
            >
              Save changes
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
