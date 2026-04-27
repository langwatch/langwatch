import { EVENT_TYPE_COLORS } from "./types";

export function hashEventTypeColor(eventType: string): string {
  let hash = 0;
  for (let i = 0; i < eventType.length; i++) {
    hash = (hash << 5) - hash + eventType.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % EVENT_TYPE_COLORS.length;
  return EVENT_TYPE_COLORS[idx]!;
}

export function formatTimestamp(ts: string) {
  try {
    const date = new Date(parseInt(ts, 10));
    if (isNaN(date.getTime())) return ts;
    return date.toISOString().replace("T", " ").replace("Z", "");
  } catch {
    return ts;
  }
}

export interface FragmentState {
  query?: string;
  tenant?: string;
  aggId?: string;
  aggTenant?: string;
  event?: number;
  proj?: string;
  detail?: boolean;
}

export function parseFragment(url: string): FragmentState {
  const hash = url.split("#")[1];
  if (!hash) return {};
  try {
    const params = new URLSearchParams(hash);
    return {
      query: params.get("q") ?? undefined,
      tenant: params.get("t") ?? undefined,
      aggId: params.get("a") ?? undefined,
      aggTenant: params.get("at") ?? undefined,
      event: params.has("e") ? parseInt(params.get("e")!, 10) : undefined,
      proj: params.get("p") ?? undefined,
      detail: params.get("d") === "1",
    };
  } catch {
    return {};
  }
}

export function buildFragment(state: FragmentState): string {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.tenant) params.set("t", state.tenant);
  if (state.aggId) params.set("a", state.aggId);
  if (state.aggTenant) params.set("at", state.aggTenant);
  if (state.event !== undefined) params.set("e", String(state.event));
  if (state.proj) params.set("p", state.proj);
  if (state.detail) params.set("d", "1");
  const str = params.toString();
  return str;
}
