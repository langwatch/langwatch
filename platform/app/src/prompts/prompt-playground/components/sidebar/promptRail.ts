import {
  getDisplayHandle,
  getPromptFolder,
} from "~/prompts/utils/promptHandle";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";

export type PromptRailGroup = {
  folder?: string;
  prompts: VersionedPrompt[];
};

export function matchesPromptRailFilter(
  prompt: VersionedPrompt,
  rawQuery: string,
): boolean {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;

  return [
    prompt.handle,
    prompt.model,
    prompt.author?.name,
    prompt.author?.email,
    ...prompt.tags.map((tag) => tag.name),
  ].some((value) => value?.toLocaleLowerCase().includes(query));
}

export function groupPromptsForRail(
  prompts: VersionedPrompt[],
): PromptRailGroup[] {
  const groups = new Map<string | undefined, VersionedPrompt[]>();

  for (const prompt of prompts) {
    const folder = getPromptFolder(prompt.handle);
    groups.set(folder, [...(groups.get(folder) ?? []), prompt]);
  }

  return [...groups.entries()]
    .sort(([folderA], [folderB]) => {
      if (folderA === undefined) return -1;
      if (folderB === undefined) return 1;
      return folderA.localeCompare(folderB);
    })
    .map(([folder, groupedPrompts]) => ({
      folder,
      prompts: [...groupedPrompts].sort(
        (a, b) =>
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          getDisplayHandle(a.handle).localeCompare(getDisplayHandle(b.handle)),
      ),
    }));
}

export function movePromptHandleToFolder({
  handle,
  folder,
}: {
  handle: string | null;
  folder?: string;
}): string {
  const name = getDisplayHandle(handle);
  return folder ? `${folder}/${name}` : name;
}
