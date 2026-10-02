import { Box, Button, HStack, Icon, Text } from "@chakra-ui/react";
import { Key, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { InlineCopyButton } from "~/features/onboarding/components/sections/shared/InlineCopyButton";

/**
 * Slim orange banner that mints an access token for a setup surface, then
 * turns into the "copy this token now" advisory once it exists. The token is
 * shown once, so the post-mint state keeps a copy button and a "Mint another"
 * action. Pair it with `useMintProjectApiKey`.
 */
export function MintApiKeyBanner({
  token,
  onMint,
  isPending,
  hint = "to fill the snippets below.",
}: {
  token: string | null;
  onMint: () => void;
  isPending: boolean;
  /** Completes "Generate an access token ..." before a token exists. */
  hint?: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={token ? "post-gen" : "pre-gen"}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      >
        <Box
          borderWidth="1px"
          borderColor="orange.muted"
          borderRadius="lg"
          bg="orange.subtle"
          paddingX={4}
          paddingY={3}
        >
          {token ? (
            <HStack justify="space-between" align="center" gap={3}>
              <HStack gap={2} align="center" color="fg" flex={1} minWidth={0}>
                <Icon
                  as={Sparkles}
                  boxSize={4}
                  color="orange.fg"
                  flexShrink={0}
                />
                <Text fontSize="sm" lineHeight="snug">
                  <Text as="span" color="orange.fg" fontWeight="semibold">
                    Copy this token before you move on.
                  </Text>{" "}
                  <Text as="span" color="fg.muted">
                    It won&apos;t be shown again.
                  </Text>
                </Text>
                <InlineCopyButton text={token} label="Token" />
              </HStack>
              <Button
                size="xs"
                variant="ghost"
                colorPalette="orange"
                onClick={onMint}
                loading={isPending}
                flexShrink={0}
              >
                <Key size={12} />
                Mint another
              </Button>
            </HStack>
          ) : (
            <HStack justify="space-between" align="center" gap={3}>
              <HStack gap={2} align="center" color="fg" flex={1} minWidth={0}>
                <Icon as={Key} boxSize={4} color="orange.fg" flexShrink={0} />
                <Text fontSize="sm" lineHeight="snug">
                  <Text as="span" fontWeight="semibold" color="fg">
                    Generate an access token
                  </Text>{" "}
                  <Text as="span" color="fg.muted">
                    {hint}
                  </Text>
                </Text>
              </HStack>
              <Button
                size="sm"
                colorPalette="orange"
                variant="solid"
                onClick={onMint}
                loading={isPending}
                flexShrink={0}
              >
                Generate access token
              </Button>
            </HStack>
          )}
        </Box>
      </motion.div>
    </AnimatePresence>
  );
}
