/**
 * Who a REST write to the experiment workbench is attributed to.
 *
 * A scoped API key carries the user it was minted for; a legacy project key
 * carries nobody, so the write is attributed to the surface rather than to a
 * person. A Langy session key is labelled as such so an agent's edits are
 * distinguishable from a person's in the version history.
 */
import type { WorkbenchActor } from "@langwatch/experiment-contract";
import type { ResolvedApiKeyToken } from "@langwatch/api-key-contract";

export const workbenchActorFrom = ({
  resolved,
}: {
  resolved: ResolvedApiKeyToken | null | undefined;
}): WorkbenchActor => {
  if (resolved?.type !== "apiKey") return { label: "api" };
  return {
    ...(resolved.userId ? { userId: resolved.userId } : {}),
    label: resolved.isLangySessionKey ? "langy" : "api",
  };
};
