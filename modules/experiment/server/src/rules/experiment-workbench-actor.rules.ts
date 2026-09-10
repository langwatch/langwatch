/**
 * Who a REST write to the experiment workbench is attributed to.
 *
 * A scoped API key carries the user it was minted for; a legacy project key
 * carries nobody, so the write is attributed to the surface rather than to a
 * person. A Langy session key is labelled as such so an agent's edits are
 * distinguishable from a person's in the version history.
 */
import type { WorkbenchActor, WorkbenchCredential } from "@langwatch/experiment-contract";

export const workbenchActorFrom = ({
  credential,
}: {
  credential: WorkbenchCredential | null | undefined;
}): WorkbenchActor => {
  if (credential?.kind !== "apiKey") return { label: "api" };
  return {
    ...(credential.userId ? { userId: credential.userId } : {}),
    label: credential.isLangySessionKey ? "langy" : "api",
  };
};
