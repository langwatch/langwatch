import { uiTokens } from "@langwatch/module";

/** What the keys panel needs from whoever mounts it: the project whose keys it manages. */
export type SigningKeysPanelProps = Readonly<{ projectId: string }>;

export const SigningKeysPanelToken =
  uiTokens("api-key").component<SigningKeysPanelProps>("signingKeysPanel");
