import { useLangyStore } from "../stores/langyStore";

/**
 * Persistent, per-browser "developer mode" for the Langy panel.
 *
 * When on, Langy stops hiding the machinery: every tool call in a turn can be
 * expanded to its raw payload (name, state, input, output), so you can see the
 * event stream behind the rendered cards. Tool calls that have no rich UI
 * mapping yet always fall back to this raw JSON view regardless of the flag —
 * developer mode additionally exposes it for the ones that DO have a card.
 *
 * Backed by the persisted slice of `useLangyStore` (localStorage), so it
 * survives reloads and never touches a user's server-side settings. Off by
 * default. Kept as a hook with the `[value, setter]` shape so consumers read
 * like `useState` and don't couple to the store's action names.
 */
export function useLangyDevMode(): [boolean, (next: boolean) => void] {
  const devMode = useLangyStore((s) => s.devMode);
  const setDevMode = useLangyStore((s) => s.setDevMode);
  return [devMode, setDevMode];
}
