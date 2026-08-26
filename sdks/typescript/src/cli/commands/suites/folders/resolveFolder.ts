import {
  SuitesApiService,
  type SuiteResponse,
} from "@/client-sdk/services/suites";

/**
 * A folder reference that names nothing, or more than one thing.
 *
 * Both readings are refusals the caller can fix from the message alone, so
 * they carry the offered names rather than a generic failure.
 */
export class FolderReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderReferenceError";
  }
}

/**
 * Finds the test suite folder a `--folder` value names.
 *
 * An id is tried first, then an exact name, then a name compared without
 * case. A name two folders share is refused with both ids, because picking
 * one for the caller would file the case somewhere they did not ask for.
 *
 * Only folders are offered: a run plan is not a place a scenario can live.
 *
 * @see specs/features/scenario-cli.feature
 * @see specs/features/suite-cli.feature
 */
export async function resolveFolderReference({
  reference,
  service,
}: {
  reference: string;
  service?: SuitesApiService;
}): Promise<SuiteResponse> {
  const suitesService = service ?? new SuitesApiService();
  const folders = await suitesService.getAll({ kind: "folder" });

  const byId = folders.find((folder) => folder.id === reference);
  if (byId) return byId;

  const wanted = reference.trim();
  const exact = folders.filter((folder) => folder.name === wanted);
  const matches =
    exact.length > 0
      ? exact
      : folders.filter(
          (folder) => folder.name.toLowerCase() === wanted.toLowerCase(),
        );

  if (matches.length === 1) return matches[0]!;

  if (matches.length > 1) {
    throw new FolderReferenceError(
      `More than one test suite folder is named "${reference}". Name it by ID instead: ${matches
        .map((folder) => folder.id)
        .join(", ")}`,
    );
  }

  throw new FolderReferenceError(
    `Test suite folder "${reference}" not found. List the folders with: langwatch suite folder list`,
  );
}
