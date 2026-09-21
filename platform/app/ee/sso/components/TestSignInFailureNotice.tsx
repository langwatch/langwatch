import { Alert, Box, Text, VStack } from "@chakra-ui/react";
import type { TestSignInFailure } from "../hooks/useTestSignIn";

/**
 * What the identity provider said, on the card that named it.
 *
 * ON THE PAGE, NOT IN A TOAST. This is the only thing on the screen an
 * administrator can actually work from when a connection refuses them, and a
 * toast is the wrong container for it three times over: it disappears while
 * they are still reading, it cannot be selected and pasted into a ticket, and
 * it appears in a corner rather than beside the connection it is about.
 *
 * THE PROVIDER'S WORDS ARE QUOTED, NOT SUMMARISED. There is no code of ours
 * to key registered copy off — the sentence came from somebody else's server
 * — so the one honest thing to do is show it verbatim, in a face that makes
 * clear it is a quotation, and put OUR advice underneath it rather than in
 * place of it.
 */
export function TestSignInFailureNotice({
  failure,
}: {
  failure: TestSignInFailure;
}) {
  return (
    <Alert.Root status="error" data-testid="test-sign-in-failure">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{failure.title}</Alert.Title>
        <Alert.Description>
          <VStack align="stretch" gap={2}>
            {failure.detail && (
              <Box
                borderRadius="md"
                background="bg.muted"
                paddingX={2}
                paddingY={1.5}
              >
                <Text
                  fontFamily="mono"
                  fontSize="xs"
                  // Selectable and wrapping: it exists to be read closely
                  // and pasted somewhere else.
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
