/**
 * Who a REST write to the experiment workbench is attributed to. A scoped
 * API key carries its minted user; a legacy key carries nobody, attributing
 * to the surface. A Langy session key is labelled, distinct from a person's.
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
