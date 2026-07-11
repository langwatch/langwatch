import { useLocalStorage } from "usehooks-ts";

/**
 * Persistent, per-browser "developer mode" for the Langy panel.
 *
 * When on, Langy stops hiding the machinery: every tool call in a turn can be
 * expanded to its raw payload (name, state, input, output), so you can see the
 * event stream behind the rendered cards. Tool calls that have no rich UI
 * mapping yet always fall back to this raw JSON view regardless of the flag —
 * developer mode additionally exposes it for the ones that DO have a card.
 *
 * Backed by localStorage so it survives reloads and never touches a user's
 * server-side settings. Off by default.
 */
const STORAGE_KEY = "langy:devMode";

export function useLangyDevMode(): [boolean, (next: boolean) => void] {
  const [devMode, setDevMode] = useLocalStorage<boolean>(STORAGE_KEY, false);
  return [devMode, setDevMode];
}
