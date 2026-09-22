// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the identity provider said, on the card that named it. ON THE PAGE,
 * NOT IN A TOAST: it is the only thing an administrator can work from when a
 * connection refuses them, and a toast disappears while they are reading,
 * cannot be pasted into a ticket, and sits away from what it is about.
 */
import { Alert, Box, Text, VStack } from "@chakra-ui/react";

import type { TestSignInFailure } from "../../model/test-sign-in-failure.ts";

export function TestSignInFailureNotice({ failure }: { failure: TestSignInFailure }) {
  return (
    <Alert.Root status="error" data-testid="test-sign-in-failure">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{failure.title}</Alert.Title>
        <Alert.Description>
          <VStack align="stretch" gap={2}>
            {/* The provider's words are quoted, not summarised: there is no
                code of ours to key registered copy off, so the honest thing
                is verbatim, in a face that says it is a quotation. */}
            {failure.detail && (
              <Box borderRadius="md" background="bg.muted" paddingX={2} paddingY={1.5}>
                <Text
                  fontFamily="mono"
                  fontSize="xs"
                  wordBreak="break-word"
                  data-testid="test-sign-in-failure-detail"
                >
                  {failure.detail}
                </Text>
              </Box>
            )}
            <Text fontSize="sm">{failure.advice}</Text>
          </VStack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
