/**
 * The backup codes, the once they are shown, written for somebody who has
 * never held one: what they are FOR comes before how they behave, and no
 * word is shortened, because these are the last way back into an account.
 */
import { Box, Button, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";

import { usePersonalWorkspaceHost } from "../../../../model/personal-workspace-host.ts";

export function BackupCodesPanel({
  codes,
  onDone,
  doneLabel = "I have saved these",
}: {
  codes: readonly string[];
  onDone: () => void;
  doneLabel?: string;
}) {
  const host = usePersonalWorkspaceHost();

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      host.succeeded({ title: "Backup codes copied" });
    } catch (error) {
      host.failed({
        error,
        fallbackTitle: "Those codes were not copied",
        description: "Select them and copy them by hand instead.",
      });
    }
  };

  return (
    <VStack align="stretch" gap={4} width="full" data-testid="two-factor-backup-codes">
      <VStack align="start" gap={2}>
        <Text fontSize="sm">
          Backup codes let you sign in when the app that makes your codes is not available: a phone
          left at home, a lost device, a new one you have not set up yet.
        </Text>
        <Text fontSize="sm">
          Each code works once. Save them somewhere only you can reach, such as a password manager.
          This is the only time they are shown.
        </Text>
      </VStack>

      <Box borderWidth="1px" borderRadius="md" padding={4} fontFamily="monospace" overflow="hidden">
        <SimpleGrid columns={{ base: 1, sm: 2 }} gap={2}>
          {codes.map((code) => (
            <Text key={code} fontSize="sm" data-testid="two-factor-backup-code">
              {code}
            </Text>
          ))}
        </SimpleGrid>
      </Box>

      <HStack gap={3} justify="end">
        <Button variant="outline" onClick={() => void copyAll()} data-testid="copy-backup-codes">
          Copy all
        </Button>
        <Button colorPalette="orange" onClick={onDone} data-testid="backup-codes-done">
          {doneLabel}
        </Button>
      </HStack>
    </VStack>
  );
}
