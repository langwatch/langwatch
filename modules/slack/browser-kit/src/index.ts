/**
 * The Slack pieces peers render: the connection copy, the picker's options and the setup
 * callout. Each consumer derives its own client from `@langwatch/slack-contract` (§3.4 rule 3).
 */
export { useCopySlackAppManifest } from "./behavior/use-copy-slack-app-manifest.ts";
export {
  NEW_CONNECTION,
  useSlackConnectionCollection,
} from "./behavior/use-slack-connection-collection.ts";
export { SLACK_APP_MANIFEST } from "./model/slack-app-manifest.ts";
export * from "./model/slack-connection-copy.ts";
export { findSlackConnection, type NamedSlackConnection } from "./model/slack-connection-name.ts";
export type {
  SlackConnection,
  SlackConnectionList,
  SlackConnectionSaved,
} from "./model/slack-connection-types.ts";
export { SlackAppSetupCallout } from "./ui/elements/slack-app-setup-callout.tsx";
