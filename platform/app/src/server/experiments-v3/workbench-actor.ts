import type { WorkbenchActor } from "@langwatch/experiment-contract";
import type { ResolvedToken } from "~/server/api-key/token-resolver";

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
