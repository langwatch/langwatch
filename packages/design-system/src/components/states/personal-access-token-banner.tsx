import { HStack, Text } from "@chakra-ui/react";
import { KeyIcon } from "lucide-react";

import { CopyButton } from "../display/copy-button.tsx";
import { Banner, BannerAction } from "./banner.tsx";

/** What a snippet shows until a personal access token has been created. */
export const API_KEY_PLACEHOLDER = "<YOUR_LANGWATCH_API_KEY>";

type PersonalAccessTokenBannerProps = {
  /** The freshly minted token, or null before one exists. Held by the caller, in memory only. */
  token: string | null;
  isCreating: boolean;
  onCreate: () => void;
  /** What this token can do, and only that, shown under the action. */
  scopeNote?: string;
  /** The action's label before a token exists; defaults to "Create a personal access token". */
  createLabel?: string;
};

/**
 * Where a project key used to be revealed: one action that mints a personal access
 * token, then the token once, with a copy button. Showing and filling snippets is the caller's.
 */
export function PersonalAccessTokenBanner({
  token,
  isCreating,
  onCreate,
  scopeNote,
  createLabel,
}: PersonalAccessTokenBannerProps) {
  return (
    <Banner
      status={token ? "warning" : "info"}
      icon={<KeyIcon size={16} aria-hidden="true" />}
      title={token ? "Copy this token now." : undefined}
      action={
        <BannerAction loading={isCreating} onClick={onCreate}>
          {token ? "Create another" : (createLabel ?? "Create a personal access token")}
        </BannerAction>
      }
    >
      {token ? (
        <HStack as="span" gap={2}>
          <span>It won&apos;t be shown again.</span>
          <CopyButton
            value={token}
            label="Personal access token"
            aria-label="Copy personal access token"
          />
        </HStack>
      ) : (
        "Create a personal access token to fill the snippets below."
      )}
      {scopeNote ? (
        <Text as="span" display="block" fontSize="xs" marginTop={1}>
          {scopeNote}
        </Text>
      ) : null}
    </Banner>
  );
}
