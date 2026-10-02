import { DeleteConfirmationDialog } from "@langwatch/design-system/delete-confirmation-dialog";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@langwatch/design-system/dialog";
import {
  Box,
  Button,
  createListCollection,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Trash2, UnplugIcon, Info } from "lucide-react";
import { useMemo } from "react";

import { useDeployTags } from "../../../../behavior/use-deploy-tags.ts";
import { usePromptHost } from "../../../../model/prompt-host.ts";
import { CopyButton } from "../../../elements/copy-button.tsx";
import { GeneratePromptApiSnippetDialog } from "./generate-prompt-api-snippet-dialog.tsx";

interface DeployPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  configId: string;
  handle: string;
  projectId: string;
}

type DeployTags = ReturnType<typeof useDeployTags>;
type VersionItem = DeployTags["versionItems"][number];

const TAG_ROW_BOX = {
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "lg",
  paddingX: 4,
  paddingY: 3,
} as const;

function TagDot({ assigned }: { assigned: boolean }) {
  return (
    <Box
      width="10px"
      height="10px"
      borderRadius="full"
      bg={assigned ? "green.400" : "gray.300"}
      flexShrink={0}
    />
  );
}

function VersionLabel({ version, commitMessage }: { version: number; commitMessage: string }) {
  return (
    <HStack gap={2} maxWidth="100%" overflow="hidden">
      <Text as="span" fontFamily="mono" fontSize="sm" fontWeight="semibold" flexShrink={0}>
        v{version}
      </Text>
      <Text as="span" fontSize="sm" color="fg.muted" truncate>
        {commitMessage}
      </Text>
    </HStack>
  );
}

function SlugChip({ handle }: { handle: string }) {
  const host = usePromptHost();
  return (
    <HStack gap={2}>
      <Box borderWidth="1px" borderColor="border" borderRadius="full" paddingX={3} paddingY={1}>
        <HStack gap={2}>
          <Text fontSize="sm" color="fg.muted">
            Slug:
          </Text>
          <Text fontSize="sm" fontWeight="medium">
            {handle}
          </Text>
          <CopyButton
            value={handle}
            label="Prompt slug"
            onCopied={(label) => host.succeeded({ title: `${label} copied` })}
            onRefused={() =>
              host.failed({
                error: new Error("Clipboard unavailable"),
                fallbackTitle: "Couldn't copy the prompt slug",
              })
            }
          />
        </HStack>
      </Box>
    </HStack>
  );
}

/** The `latest` row: moved by the platform, never edited here. */
function LatestTagRow({ latestVersion }: { latestVersion: DeployTags["latestVersion"] }) {
  return (
    <Box {...TAG_ROW_BOX}>
      <HStack justify="space-between">
        <HStack gap={3}>
          <TagDot assigned />
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
  );
}

/** One environment tag: which version it names, its snippet, and its delete. */
function TagVersionRow({
  tagName,
  selectedVersionId,
  versionItems,
  onSelect,
  onDelete,
  handle,
}: {
  tagName: string;
  selectedVersionId: string | undefined;
  versionItems: VersionItem[];
  onSelect: (versionId: string) => void;
  onDelete: () => void;
  handle: string;
}) {
  const versionCollection = useMemo(
    () => createListCollection({ items: versionItems }),
    [versionItems],
  );

  return (
    <Box {...TAG_ROW_BOX}>
      <HStack justify="space-between" gap={3}>
        <HStack gap={3} flexShrink={0}>
          <TagDot assigned={!!selectedVersionId} />
          <Text fontWeight="medium" fontSize="sm">
            {tagName}
          </Text>
        </HStack>
        <HStack gap={2} flex="1" minWidth={0} justify="flex-end">
          <Select.Root
            collection={versionCollection}
            size="sm"
            flex="1"
            minWidth={0}
            maxWidth="280px"
            value={selectedVersionId ? [selectedVersionId] : []}
            onValueChange={(details) => onSelect(details.value[0] ?? "")}
            aria-label={`${tagName.charAt(0).toUpperCase()}${tagName.slice(1)} version`}
          >
            <Select.Trigger clearable data-testid={`prompt-deploy-tag-trigger-${tagName}`}>
              <Select.ValueText placeholder="Select version">
                {(items) => {
                  const item = items[0] as VersionItem | undefined;
                  if (!item) return "Select version";
                  return <VersionLabel version={item.version} commitMessage={item.commitMessage} />;
                }}
              </Select.ValueText>
            </Select.Trigger>
            <Select.Content>
              {versionItems.map((v) => (
                <Select.Item
                  key={v.value}
                  item={v}
                  data-testid={`prompt-deploy-tag-${tagName}-version-${v.version}`}
                >
                  <Tooltip content={v.commitMessage} openDelay={500}>
                    <VersionLabel version={v.version} commitMessage={v.commitMessage} />
                  </Tooltip>
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <GeneratePromptApiSnippetDialog promptHandle={handle} label={tagName}>
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
          <IconButton
            variant="ghost"
            size="xs"
            aria-label={`Delete tag ${tagName}`}
            css={{ boxShadow: "none !important" }}
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </IconButton>
        </HStack>
      </HStack>
    </Box>
  );
}

/** "+ Add tag", opening into a name field with Add and Cancel. */
function AddTagControl({ addTag }: { addTag: DeployTags["addTag"] }) {
  if (!addTag.isAddingTag) {
    return (
      <Button
        variant="ghost"
        size="sm"
        alignSelf="flex-start"
        data-testid="prompt-deploy-add-tag"
        onClick={addTag.startAddTag}
      >
        + Add tag
      </Button>
    );
  }
  return (
    <HStack gap={2}>
      <Input
        size="sm"
        placeholder="Tag name (e.g. canary)"
        data-testid="prompt-deploy-tag-name-input"
        value={addTag.newTagName}
        onChange={(e) => addTag.editNewTagName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void addTag.confirmAddTag();
          if (e.key === "Escape") addTag.cancelAddTag();
        }}
      />
      <Button
        size="sm"
        colorPalette="orange"
        data-testid="prompt-deploy-tag-add-confirm"
        onClick={() => void addTag.confirmAddTag()}
        loading={addTag.isSubmittingTag}
      >
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={addTag.cancelAddTag}>
        Cancel
      </Button>
    </HStack>
  );
}

export function DeployPromptDialog({
  isOpen,
  onClose,
  configId,
  handle,
  projectId,
}: DeployPromptDialogProps) {
  const tags = useDeployTags({ isOpen, onClose, configId, projectId });
  const { tagToDelete, setTagToDelete } = tags;

  return (
    <DialogRoot open={isOpen} onOpenChange={(e) => !e.open && onClose()} size="md">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deploy prompt</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.muted">
              Use tags to get specific prompt versions via the SDK and API. Prompt versions with the
              production tag are returned by default.
            </Text>

            <SlugChip handle={handle} />

            <VStack align="stretch" gap={3}>
              <LatestTagRow latestVersion={tags.latestVersion} />

              {tags.nonLatestTags.map((tagDef) => (
                <TagVersionRow
                  key={tagDef.name}
                  tagName={tagDef.name}
                  selectedVersionId={tags.tagSelections[tagDef.name]}
                  versionItems={tags.versionItems}
                  onSelect={(versionId) => tags.setTagVersionId(tagDef.name, versionId)}
                  onDelete={() => setTagToDelete({ name: tagDef.name })}
                  handle={handle}
                />
              ))}

              <AddTagControl addTag={tags.addTag} />

              {tags.addTag.addTagError && (
                <Text fontSize="sm" color="red.500">
                  {tags.addTag.addTagError}
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
              data-testid="prompt-deploy-save"
              onClick={() => void tags.handleSave()}
              loading={tags.isSaving}
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
          if (tagToDelete) void tags.confirmDeleteTag(tagToDelete.name);
        }}
      />
    </DialogRoot>
  );
}
