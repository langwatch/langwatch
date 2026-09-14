import {
  Box,
  Button,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { toaster } from "~/components/ui/toaster";

/**
 * The backup codes, the once they are shown.
 *
 * Everything on this screen is written for somebody who has never held one.
 * The words say what they are FOR — signing in when the authenticator is not
 * to hand — before they say anything about how they behave, because a list of
 * ten strings with no explanation is a screen people close.
 *
 * Nothing here is shortened. "Two-step verification", not an initialism; "the
 * app that makes your codes", not a category name; "each one works once", not
 * "single-use". A shortened word saves a few pixels and costs the reader a
 * guess, and at this particular screen the guess is expensive: these are the
 * last way back into an account.
 */
export function BackupCodesPanel({
  codes,
  onDone,
  doneLabel = "I have saved these",
}: {
  codes: readonly string[];
  onDone: () => void;
  doneLabel?: string;
}) {
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toaster.success({ title: "Backup codes copied" });
    } catch {
      toaster.error({
        title: "Those codes were not copied",
        description: "Select them and copy them by hand instead.",
      });
    }
  };

  return (
    <VStack
      align="stretch"
      gap={4}
      width="full"
      data-testid="two-factor-backup-codes"
    >
      <VStack align="start" gap={2}>
        <Text fontSize="sm">
          Backup codes let you sign in when the app that makes your codes is not
          available — a phone left at home, a lost device, a new one you have
          not set up yet.
        </Text>
        <Text fontSize="sm">
          Each code works once. Save them somewhere only you can reach, such as
          a password manager. This is the only time they are shown.
        </Text>
      </VStack>

      <Box
        position="relative"
        borderWidth="1px"
        borderRadius="md"
        padding={4}
        fontFamily="monospace"
        overflow="hidden"
      >
        <SimpleGrid columns={{ base: 1, sm: 2 }} gap={2}>
          {codes.map((code) => (
            <Text key={code} fontSize="sm" data-testid="two-factor-backup-code">
              {code}
            </Text>
          ))}
        </SimpleGrid>
      </Box>

      <HStack gap={3} justify="end">
        <Button
          variant="outline"
          onClick={() => void copyAll()}
          data-testid="copy-backup-codes"
        >
          Copy all
        </Button>
        <Button
          colorPalette="orange"
          onClick={onDone}
          data-testid="backup-codes-done"
        >
          {doneLabel}
        </Button>
      </HStack>
    </VStack>
  );
}
