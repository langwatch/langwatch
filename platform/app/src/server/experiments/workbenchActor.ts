import type { ResolvedToken } from "~/server/api-key/token-resolver";
import type { WorkbenchActor } from "./experiment.service";

/**
 * Who a REST write to an experiment is attributed to.
 *
 * Langy signs its own writes: the chat mints an ephemeral key for itself, and
 * a version written through it must read as "Langy" in the history rather than
 * as an anonymous integration. Every other key is an integration, which is
 * what `api` means. The user id rides along when the key has one, so a
 * personal key still names the person who minted it.
 *
 * One module, because the create endpoint and the workbench endpoints both
 * attribute the same key. Two copies of this rule would let one key read as
 * Langy on one endpoint and as an integration on the other.
 *
 * Type-only imports keep this module free of any runtime dependency, so a
 * route can pull it in without pulling in a service.
 */
export const workbenchActorFrom = ({
  resolved,
}: {
  resolved: ResolvedToken | null | undefined;
}): WorkbenchActor => {
  if (resolved?.type !== "apiKey") return { label: "api" };
  return {
    ...(resolved.userId ? { userId: resolved.userId } : {}),
    label: resolved.isLangySessionKey ? "langy" : "api",
  };
};
