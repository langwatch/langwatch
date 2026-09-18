/** Package exports: the session read, refresh and client — auth's subject. */

export {
  readUiActor,
  SessionReadFailedError,
  signOutUi,
  toUiActor,
  UI_SESSION_PATH,
  UI_SESSION_QUERY_KEY,
  uiAuthClient,
  type UiAuthClient,
  type UiSessionReading,
} from "./behavior/ui-session-client.ts";
export { useRefreshUiSession } from "./behavior/ui-session-refresh.ts";
