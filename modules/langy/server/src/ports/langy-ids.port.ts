export const LANGY_ID_RESOURCES = {
  conversation: "langyconv",
  message: "langymsg",
} as const;

/** Mints a KSUID for one of Langy's named id resources. */
export abstract class LangyIdsPort {
  abstract generateId(resource: keyof typeof LANGY_ID_RESOURCES): string;
}
