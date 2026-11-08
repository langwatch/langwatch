import { createHmac } from "node:crypto";

/** Domain-separates this use of a server secret that also has other jobs. */
const KEY_PURPOSE = "coding-agent-repository-key";

/** A session's repo as its state names it; a null host is the deployment's own. */
export type SessionRepository = Readonly<{
  repositoryHost: string | null;
  repositoryOwner: string;
  repositoryName: string;
}>;

/** The key standing for a repo; null where the deployment holds no secret to key it with. */
export type RepositoryKeyOf = (repository: SessionRepository) => string | null;

/**
 * Keys a session's repo so a peer can count repos without holding a name. An HMAC: anyone reading
 * a plain hash, salted with the organization id or not, could test a guessed name. No secret, no
 * key. Lowercased because git hosts treat `Acme/API` and `acme/api` as one repo.
 */
export function repositoryKeyOfWith({
  secret,
  normalizeHost,
}: Readonly<{ secret: string; normalizeHost: (host: string) => string }>): RepositoryKeyOf {
  return ({ repositoryHost, repositoryOwner, repositoryName }) => {
    if (secret === "") return null;
    const host = normalizeHost(repositoryHost ?? "");
    const repository = `${KEY_PURPOSE}\0${host}\0${repositoryOwner}\0${repositoryName}`;
    return createHmac("sha256", secret).update(repository.toLowerCase()).digest("hex");
  };
}
