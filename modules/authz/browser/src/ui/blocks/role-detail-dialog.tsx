// Everything a role can do, read rather than edited, grouped by the part of the
// product it is about; each line carries the sentence and the token (main's RoleDetailDialog).

import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import { permissionSentence, permissionsByArea } from "../../model/role-permissions.ts";
import { PermissionToken } from "../elements/permission-token.tsx";
import { SectionEyebrow } from "./role-cards.tsx";

export function RoleDetailDialog({
  open,
  onClose,
  title,
  description,
  permissions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string | null;
  permissions: readonly string[];
}) {
  const byArea = permissionsByArea(permissions);

  return (
    <Dialog.Root open={open} onOpenChange={({ open: isOpen }) => !isOpen && onClose()}>
      <Dialog.Content bg="bg" maxWidth="640px" maxHeight="80vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={6} align="stretch">
            {description ? (
              <Text color="fg.muted" fontSize="sm">
                {description}
              </Text>
            ) : null}

            <Text fontSize="sm" color="fg.muted">
              {permissions.length} {permissions.length === 1 ? "permission" : "permissions"} across{" "}
              {byArea.length} {byArea.length === 1 ? "area" : "areas"}.
            </Text>

            {byArea.length === 0 ? (
              <Text fontSize="sm" color="fg.subtle">
                This role grants nothing yet.
              </Text>
            ) : (
              byArea.map(({ area, permissions: areaPermissions }) => (
                <VStack key={area} align="stretch" gap={2}>
                  <SectionEyebrow>{area}</SectionEyebrow>
                  <VStack align="stretch" gap={1.5}>
                    {areaPermissions.map((permission) => (
                      <HStack key={permission} gap={3} align="center">
                        <Box minWidth="150px" flexShrink={0}>
                          <PermissionToken permission={permission} />
                        </Box>
                        <Text fontSize="sm" color="fg">
                          {permissionSentence(permission)}
                        </Text>
                      </HStack>
                    ))}
                  </VStack>
                </VStack>
              ))
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
