/** Which version each tag names in the deploy dialog, by tag name; "" is unassigned. */
export type TagSelections = Record<string, string>;

type TagDefinition = { name: string; id?: string };
type TagAssignment = { promptTag: { id: string }; versionId: string };

/** Every tag but `latest`, which the platform moves itself. */
export const editableTags = <Tag extends TagDefinition>(tags: readonly Tag[]): Tag[] =>
  tags.filter((t) => t.name !== "latest");

const assignedVersionId = ({
  tag,
  assignments,
}: {
  tag: TagDefinition;
  assignments: readonly TagAssignment[];
}): string =>
  (tag.id ? assignments.find((t) => t.promptTag.id === tag.id) : undefined)?.versionId ?? "";

/** Selections seeded from the stored assignments; an unsaved pick the user made wins. */
export function seedTagSelections({
  previous,
  tags,
  assignments,
}: {
  previous: TagSelections;
  tags: readonly TagDefinition[];
  assignments: readonly TagAssignment[];
}): TagSelections {
  const next: TagSelections = {};
  for (const tag of editableTags(tags)) {
    next[tag.name] = previous[tag.name] ?? assignedVersionId({ tag, assignments });
  }
  return next;
}

/** The tag moves a save makes: a selected version that differs from the stored one. */
export function changedTagAssignments({
  tags,
  assignments,
  selections,
}: {
  tags: readonly TagDefinition[];
  assignments: readonly TagAssignment[];
  selections: TagSelections;
}): { tag: string; versionId: string }[] {
  return editableTags(tags).flatMap((tag) => {
    const versionId = selections[tag.name] ?? "";
    const unchanged = !versionId || versionId === assignedVersionId({ tag, assignments });
    return unchanged ? [] : [{ tag: tag.name, versionId }];
  });
}

/** What the add-tag field says when creating a tag was refused. */
export function addTagErrorMessage({ error, name }: { error: unknown; name: string }): string {
  const message = error instanceof Error ? error.message : "Failed to create tag";
  return message.toLowerCase().includes("already exists") ? `${name} already exists` : message;
}
