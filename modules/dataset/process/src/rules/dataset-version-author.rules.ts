import type { Actor } from "@langwatch/authorization";
import type {
  DatasetVersion,
  DatasetVersionAuthor,
  DatasetVersionListItem,
} from "@langwatch/dataset-contract";

/** Who a change is recorded as: the door's user, else its API key, else the platform itself. */
export function datasetAuthorOf({ actor }: { actor: Actor | null }): DatasetVersionAuthor {
  if (actor?.type === "user") return { kind: "user", id: actor.id };
  if (actor?.type === "api_key") return { kind: "api_key", id: actor.id };
  return { kind: "system", id: null };
}

/** The user ids that saved these versions, each once. */
export function versionAuthorUserIds(
  versions: readonly Pick<DatasetVersion, "authorKind" | "authorId">[],
): string[] {
  const ids = new Set<string>();
  for (const version of versions) {
    if (version.authorKind === "user" && version.authorId) ids.add(version.authorId);
  }
  return [...ids];
}

/** Each version with the name of the user who saved it; null for keys, the system or no name. */
export function withAuthorNames({
  versions,
  names,
}: {
  versions: readonly DatasetVersion[];
  names: ReadonlyMap<string, string>;
}): DatasetVersionListItem[] {
  return versions.map((version) => ({
    ...version,
    authorName:
      version.authorKind === "user" && version.authorId
        ? (names.get(version.authorId) ?? null)
        : null,
  }));
}
