import { useCallback, useEffect, useMemo, useState } from "react";

import {
  addTagErrorMessage,
  changedTagAssignments,
  editableTags,
  seedTagSelections,
  type TagSelections,
} from "../model/deploy-tags.ts";
import { usePromptHost } from "../model/prompt-host.ts";
import { promptApi } from "./prompt-api.ts";
import { usePromptTags } from "./use-prompt-tags.ts";

/** The deploy dialog's versions, one select item each, newest first. */
function useVersionItems({
  versions,
}: {
  versions: { version: number; versionId: string; commitMessage?: string | null }[];
}) {
  return useMemo(
    () =>
      [...versions]
        .toSorted((a, b) => b.version - a.version)
        .map((v) => ({
          label: `v${v.version}: ${v.commitMessage ?? "No message"}`,
          value: v.versionId,
          version: v.version,
          commitMessage: v.commitMessage ?? "No message",
        })),
    [versions],
  );
}

/** Creating a tag inline: the draft name, its refusal, and the request in flight. */
function useAddTag({ projectId, refetchTags }: { projectId: string; refetchTags: () => unknown }) {
  const createTag = promptApi.promptTags.create.useMutation();
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [addTagError, setAddTagError] = useState("");
  const [isSubmittingTag, setIsSubmittingTag] = useState(false);

  const cancelAddTag = useCallback(() => {
    setIsAddingTag(false);
    setNewTagName("");
    setAddTagError("");
  }, []);

  const editNewTagName = useCallback((name: string) => {
    setNewTagName(name);
    setAddTagError("");
  }, []);

  const confirmAddTag = useCallback(async () => {
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
      setAddTagError(addTagErrorMessage({ error, name }));
    } finally {
      setIsSubmittingTag(false);
    }
  }, [newTagName, projectId, createTag, refetchTags]);

  return {
    isAddingTag,
    startAddTag: () => setIsAddingTag(true),
    cancelAddTag,
    newTagName,
    editNewTagName,
    addTagError,
    isSubmittingTag,
    confirmAddTag,
  };
}

/**
 * Everything the deploy dialog reads and writes: the prompt's versions, its
 * tags and their assignments, the selections being edited, and tag
 * creation and deletion.
 */
export function useDeployTags({
  isOpen,
  onClose,
  configId,
  projectId,
}: {
  isOpen: boolean;
  onClose: () => void;
  configId: string;
  projectId: string;
}) {
  const host = usePromptHost();
  const utils = promptApi.useUtils();
  const { data: allTags, refetch: refetchTags } = usePromptTags({
    projectId,
    enabled: isOpen && !!projectId,
  });
  const promptReady = isOpen && !!configId && !!projectId;
  const versionsQuery = promptApi.prompts.getAllVersionsForPrompt.useQuery(
    { idOrHandle: configId, projectId },
    { enabled: promptReady },
  );
  const tagsQuery = promptApi.prompts.getTagsForConfig.useQuery(
    { configId, projectId },
    { enabled: promptReady },
  );
  const assignTag = promptApi.prompts.assignTag.useMutation();
  const deleteTag = promptApi.promptTags.delete.useMutation();

  const versions = useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  const latestVersion = versions.reduce<(typeof versions)[number] | null>(
    (max, v) => (!max || v.version > max.version ? v : max),
    null,
  );
  const versionItems = useVersionItems({ versions });

  const [tagSelections, setTagSelections] = useState<TagSelections>({});
  const setTagVersionId = useCallback((tag: string, versionId: string) => {
    setTagSelections((prev) => ({ ...prev, [tag]: versionId }));
  }, []);

  // A refetch after add/delete keeps the unsaved picks.
  useEffect(() => {
    if (!isOpen) return;
    setTagSelections((previous) =>
      seedTagSelections({ previous, tags: allTags, assignments: tagsQuery.data ?? [] }),
    );
  }, [isOpen, tagsQuery.data, allTags]);

  const [isSaving, setIsSaving] = useState(false);
  const handleSave = useCallback(async () => {
    const changes = changedTagAssignments({
      tags: allTags,
      assignments: tagsQuery.data ?? [],
      selections: tagSelections,
    });
    if (changes.length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      await Promise.all(
        changes.map(({ tag, versionId }) =>
          assignTag.mutateAsync({ projectId, configId, versionId, tag }),
        ),
      );
      await utils.prompts.getTagsForConfig.invalidate({ configId, projectId });
      host.succeeded({ title: "Tags saved" });
      onClose();
    } catch {
      host.failed({
        error: new Error("Failed to save tags"),
        fallbackTitle: "Couldn't save the tags",
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
    host,
  ]);

  const [tagToDelete, setTagToDelete] = useState<{ name: string } | null>(null);
  const confirmDeleteTag = useCallback(
    async (tagName: string) => {
      setTagToDelete(null);
      try {
        await deleteTag.mutateAsync({ projectId, name: tagName });
        await refetchTags();
      } catch {
        host.failed({
          error: new Error("Failed to delete tag"),
          fallbackTitle: "Couldn't delete the tag",
        });
      }
    },
    [projectId, deleteTag, refetchTags, host],
  );

  const addTag = useAddTag({ projectId, refetchTags });

  return {
    latestVersion,
    versionItems,
    nonLatestTags: editableTags(allTags),
    tagSelections,
    setTagVersionId,
    isSaving,
    handleSave,
    tagToDelete,
    setTagToDelete,
    confirmDeleteTag,
    addTag,
  };
}
