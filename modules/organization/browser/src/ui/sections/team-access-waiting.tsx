/**
 * Signed in to an organization but on none of its teams: nothing to open yet.
 * Shown in place of the dashboard body; the administrator adding them to a
 * team is what ends the wait.
 */
import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Clock3 } from "lucide-react";

import { useOrganizationHost } from "../../model/organization-host.ts";

export function TeamAccessWaiting({
  organizationName,
  onCheckAccess,
}: {
  organizationName: string;
  onCheckAccess: () => void;
}) {
  const host = useOrganizationHost();

  return (
    <Dialog.Root
      open
      size="cover"
      placement="center"
      closeOnInteractOutside={false}
      closeOnEscape={false}
      onOpenChange={() => void 0}
    >
      <Dialog.Content aria-label="Waiting for team access" bg="bg" borderRadius={0}>
        <Dialog.Body display="flex" alignItems="center" justifyContent="center" padding={6}>
          <VStack width="full" maxWidth="420px" align="stretch" gap="18px">
            <Box display="flex" justifyContent="center" color="fg.muted">
              <Clock3 size={28} aria-hidden="true" />
            </Box>
            <Dialog.Title fontSize="22px" fontWeight={600} textAlign="center">
              Waiting for team access
            </Dialog.Title>
            <Text textAlign="center">You’re signed in to {organizationName}.</Text>
            <Text textAlign="center" color="fg.muted">
              Ask your organization’s administrator to add you to a team. Once they do, you’ll be
              able to open its projects.
            </Text>
            <Button colorPalette="orange" width="full" minHeight="44px" onClick={onCheckAccess}>
              Check access
            </Button>
            <Button variant="outline" width="full" minHeight="44px" asChild>
              <a href="/">Back to home</a>
            </Button>
            <Button variant="outline" width="full" minHeight="44px" onClick={() => host.signOut()}>
              Sign out
            </Button>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export default TeamAccessWaiting;
