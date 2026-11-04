/**
 * Who a REST write to the experiment workbench is attributed to. A scoped
 * API key carries its minted user; a legacy key carries nobody, attributing
 * to the surface. A Langy session key is labelled, distinct from a person's.
 */
import type { DatasetVersionAuthor } from "@langwatch/dataset-contract";
import type { WorkbenchActor, WorkbenchCredential } from "@langwatch/experiment-contract";

export const workbenchActorFrom = ({
  credential,
}: {
  credential: WorkbenchCredential | null | undefined;
}): WorkbenchActor => {
  if (credential?.kind === "cliAccessToken") return { userId: credential.userId, label: "api" };
  if (credential?.kind !== "apiKey") return { label: "api" };
  return {
    ...(credential.userId ? { userId: credential.userId } : {}),
    label: credential.isLangySessionKey ? "langy" : "api",
  };
};

/** Who a dataset version a REST run saves is attributed to: the key's person, else the key. */
export const datasetVersionAuthorFrom = ({
  credential,
}: {
  credential: WorkbenchCredential | null | undefined;
}): DatasetVersionAuthor => {
  if (credential?.kind === "cliAccessToken") return { kind: "user", id: credential.userId };
  if (credential?.kind === "apiKey" && credential.userId) {
    return { kind: "user", id: credential.userId };
  }
  return { kind: "api_key", id: null };
};
