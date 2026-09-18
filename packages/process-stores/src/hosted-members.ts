import type { ProcessMemberSource } from "./create-members.ts";

/** Host before the runtime so its stores close after the runtime stops. */
export function hostedMembers(source: ProcessMemberSource) {
  return { name: "process stores", stop: () => source.close() };
}
