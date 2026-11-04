import { createHash } from "node:crypto";

/**
 * A hash standing for a session's repo, so a peer can count distinct repos without ever holding a
 * repo's name. Lowercased because git hosts treat `Acme/API` and `acme/api` as one repo.
 */
export function repositoryKeyOf({
  repositoryHost,
  repositoryOwner,
  repositoryName,
}: Readonly<{
  repositoryHost: string | null;
  repositoryOwner: string;
  repositoryName: string;
}>): string {
  const repository = `${repositoryHost ?? ""}\0${repositoryOwner}\0${repositoryName}`;
  return createHash("sha256").update(repository.toLowerCase()).digest("hex");
}
