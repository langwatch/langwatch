import { moduleApi } from "@langwatch/module";

/** Usage answers by events (§3): no peer asks it, so the token carries no operation yet. */
export type UsageApi = Readonly<Record<never, never>>;

export const UsageApi = moduleApi<UsageApi>()("usage");
