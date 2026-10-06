import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { KeyIcon } from "lucide-react";

import { CopyButton } from "./copy-button.tsx";

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
    <Box
      borderWidth="1px"
      borderColor="orange.muted"
      borderRadius="lg"
      bg="orange.subtle"
      paddingX={4}
      paddingY={3}
    >
      <HStack justify="space-between" align="center" gap={3}>
        <HStack gap={2} flex={1} minWidth={0}>
          <KeyIcon size={16} aria-hidden="true" />
          {token ? (
            <>
              <Text fontSize="sm">
                <Text as="span" fontWeight="semibold">
                  Copy this token now.
                </Text>{" "}
                <Text as="span" color="fg.muted">
                  It won&apos;t be shown again.
                </Text>
              </Text>
              <CopyButton
                value={token}
                label="Personal access token"
                aria-label="Copy personal access token"
              />
            </>
          ) : (
            <Text fontSize="sm" color="fg.muted">
              Create a personal access token to fill the snippets below.
            </Text>
          )}
        </HStack>
        <Button
          size="sm"
          variant={token ? "ghost" : "solid"}
          colorPalette="orange"
          loading={isCreating}
          onClick={onCreate}
          flexShrink={0}
        >
          {token ? "Create another" : (createLabel ?? "Create a personal access token")}
        </Button>
      </HStack>
      {scopeNote ? (
        <Text fontSize="xs" color="fg.muted" marginTop={2}>
          {scopeNote}
        </Text>
      ) : null}
    </Box>
  );
}
