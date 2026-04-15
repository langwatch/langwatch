import {
  Box,
  Button,
  createListCollection,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Info } from "react-feather";
import { Trash2, UnplugIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DeleteConfirmationDialog } from "~/components/annotations/DeleteConfirmationDialog";
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
import { usePromptTags } from "~/prompts/hooks/usePromptTags";
import { api } from "~/utils/api";

interface DeployPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  configId: string;
  handle: string;
  projectId: string;
}

export function DeployPromptDialog({
  isOpen,
  onClose,
  configId,
  handle,
  projectId,
}: DeployPromptDialogProps) {
  const { project } = useOrganizationTeamProject();

  const { data: allTags, refetch: refetchTags } = usePromptTags({
    projectId,
    enabled: isOpen && !!projectId,
  });

  const versionsQuery = api.prompts.getAllVersionsForPrompt.useQuery(
    { idOrHandle: configId, projectId },
    { enabled: isOpen && !!configId && !!projectId },
  );

  const tagsQuery = api.prompts.getTagsForConfig.useQuery(
    { configId, projectId },
    { enabled: isOpen && !!configId && !!projectId },
  );

  const assignTag = api.prompts.assignTag.useMutation();
  const createTag = api.promptTags.create.useMutation();
  const deleteTag = api.promptTags.delete.useMutation();
  const utils = api.useContext();

  const versions = versionsQuery.data ?? [];

  const latestVersion = versions.reduce<(typeof versions)[number] | null>(
    (max, v) => (!max || v.version > max.version ? v : max),
    null,
  );

  type TagSelections = Record<string, string>;
  const [tagSelections, setTagSelections] = useState<TagSelections>({});

  const setTagVersionId = useCallback((tag: string, versionId: string) => {
    setTagSelections((prev) => ({ ...prev, [tag]: versionId }));
  }, []);

  // Initialize selections from current tag assignments whenever tags or assignments change.
  // Existing user edits (prev) take precedence over freshly derived values so that
  // a refetch triggered by add/delete does not wipe unsaved version selections.
  useEffect(() => {
    if (!isOpen) return;
    const assignmentData = tagsQuery.data ?? [];
    const nonLatestTags = allTags.filter((t) => t.name !== "latest");
    setTagSelections((prev) => {
      const next: TagSelections = {};
      for (const tagDef of nonLatestTags) {
        const found = tagDef.id
          ? assignmentData.find((t) => t.tagId === tagDef.id)
          : undefined;
        next[tagDef.name] = prev[tagDef.name] ?? found?.versionId ?? "";
      }
      return next;
    });
  }, [isOpen, tagsQuery.data, allTags]);

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const data = tagsQuery.data ?? [];
    const mutations: Promise<unknown>[] = [];
    const nonLatestTags = allTags.filter((t) => t.name !== "latest");

    for (const tagDef of nonLatestTags) {
      const selectedVersionId = tagSelections[tagDef.name] ?? "";
      const currentTag = tagDef.id
        ? data.find((t) => t.tagId === tagDef.id)
        : undefined;
      if (
        selectedVersionId &&
        selectedVersionId !== (currentTag?.versionId ?? "")
      ) {
        mutations.push(
          assignTag.mutateAsync({
            projectId,
            configId,
            versionId: selectedVersionId,
            tag: tagDef.name,
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
      await utils.prompts.getTagsForConfig.invalidate({ configId, projectId });
      toaster.create({
        title: "Tags saved",
        type: "success",
        duration: 2000,
        meta: { closable: true },
      });
      onClose();
    } catch {
      toaster.create({
        title: "Failed to save tags",
        type: "error",
        duration: 3000,
        meta: { closable: true },
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    tagsQuery.data,
    tagSelections,
    allTags,
    assignTag,
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

  // Add tag inline state
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [addTagError, setAddTagError] = useState("");
  const [isSubmittingTag, setIsSubmittingTag] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<{
    name: string;
  } | null>(null);

  const handleAddTagConfirm = useCallback(async () => {
    const name = newTagName.trim();
    if (!name) return;
    setIsSubmittingTag(true);
    setAddTagError("");
    try {
      await createTag.mutateAsync({ projectId, name });
      await refetchTags();
      setIsAddingTag(false);
      setNewTagName("");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create tag";
      if (message.toLowerCase().includes("already exists")) {
        setAddTagError(`${name} already exists`);
      } else {
        setAddTagError(message);
      }
    } finally {
      setIsSubmittingTag(false);
    }
  }, [newTagName, projectId, createTag, refetchTags]);

  const confirmDeleteTag = useCallback(
    async (tagName: string) => {
      setTagToDelete(null);
      try {
        await deleteTag.mutateAsync({ projectId, name: tagName });
        await refetchTags();
      } catch {
        toaster.create({
          title: "Failed to delete tag",
          type: "error",
          duration: 3000,
          meta: { closable: true },
        });
      }
    },
    [projectId, deleteTag, refetchTags],
  );

  const nonLatestTags = allTags.filter((t) => t.name !== "latest");

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
              Use tags to get specific prompt versions via the SDK and API.
              Prompt versions with the production tag are returned by default.
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

            {/* Tag rows */}
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

              {/* Environment tag rows (built-in + custom, excluding latest) */}
              {nonLatestTags.map((tagDef) => {
                const isAssigned = !!(tagSelections[tagDef.name]);
                return (
                  <Box
                    key={tagDef.name}
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
                          {tagDef.name}
                        </Text>
                      </HStack>
                      <HStack gap={2}>
                        <Select.Root
                          collection={versionCollection}
                          size="sm"
                          width="auto"
                          minWidth="180px"
                          value={tagSelections[tagDef.name] ? [tagSelections[tagDef.name] ?? ""] : []}
                          onValueChange={(details) => {
                            setTagVersionId(tagDef.name, details.value[0] ?? "");
                          }}
                          aria-label={`${tagDef.name.charAt(0).toUpperCase()}${tagDef.name.slice(1)} version`}
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
                          label={tagDef.name}
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
                        {tagDef.name !== "latest" && (
                          <IconButton
                            variant="ghost"
                            size="xs"
                            aria-label={`Delete tag ${tagDef.name}`}
                            css={{ boxShadow: "none !important" }}
                            onClick={() =>
                              setTagToDelete({
                                name: tagDef.name,
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        )}
                      </HStack>
                    </HStack>
                  </Box>
                );
              })}

              {/* Add tag inline input or button */}
              {isAddingTag ? (
                <HStack gap={2}>
                  <Input
                    size="sm"
                    placeholder="Tag name (e.g. canary)"
                    value={newTagName}
                    onChange={(e) => {
                      setNewTagName(e.target.value);
                      setAddTagError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddTagConfirm();
                      if (e.key === "Escape") {
                        setIsAddingTag(false);
                        setNewTagName("");
                        setAddTagError("");
                      }
                    }}
                    autoFocus
                  />
                  <Button
                    size="sm"
                    colorPalette="orange"
                    onClick={() => void handleAddTagConfirm()}
                    loading={isSubmittingTag}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsAddingTag(false);
                      setNewTagName("");
                      setAddTagError("");
                    }}
                  >
                    Cancel
                  </Button>
                </HStack>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  alignSelf="flex-start"
                  onClick={() => setIsAddingTag(true)}
                >
                  + Add tag
                </Button>
              )}

              {addTagError && (
                <Text fontSize="sm" color="red.500">
                  {addTagError}
                </Text>
              )}
            </VStack>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              size="sm"
              onClick={() => void handleSave()}
              loading={isSaving}
            >
              Save
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>

      <DeleteConfirmationDialog
        title={`Delete tag "${tagToDelete?.name ?? ""}"?`}
        description="SDK and API callers using this tag will no longer be able to resolve it to a prompt version. Type 'delete' below to confirm:"
        open={tagToDelete !== null}
        onClose={() => setTagToDelete(null)}
        onConfirm={() => {
          if (tagToDelete) {
            void confirmDeleteTag(tagToDelete.name);
          }
        }}
      />
    </DialogRoot>
  );
}
