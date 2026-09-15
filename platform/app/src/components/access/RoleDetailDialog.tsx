import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "../ui/dialog";
import { PermissionToken } from "./PermissionToken";
import { SectionEyebrow } from "./RoleCards";
import {
  PERMISSION_AREAS,
  type PermissionArea,
  permissionSentence,
  resourceCopy,
  splitPermission,
} from "./rolePermissions";

/**
 * Everything a role can do, read rather than edited.
 *
 * Grouped by the part of the product it is about, because "what can this role
 * reach" is asked area by area — can they see the traces, can they touch the
 * gateway — and a flat alphabetical list of sixty tokens answers that question
 * only for somebody who already knew it. Each line carries both the sentence
 * and the token: the sentence is what the reader is deciding about, the token
 * is what they will see again in the audit log.
 */
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
  const byArea = groupByArea(permissions);

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content
        bg="bg"
        maxWidth="640px"
        maxHeight="80vh"
        overflowY="auto"
      >
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
              {permissions.length}{" "}
              {permissions.length === 1 ? "permission" : "permissions"} across{" "}
              {byArea.length} {byArea.length === 1 ? "area" : "areas"}.
            </Text>

            {byArea.length === 0 ? (
              <Text fontSize="sm" color="fg.subtle">
                This role grants nothing yet.
              </Text>
            ) : (
              byArea.map(({ area, permissions: areaPermissions }) => (
                <VStack key={area} align="stretch" gap={2}>
                  {/* The same eyebrow the role cards lead their sections
                      with — one spelling for one element, whatever container
                      it sits in. */}
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

function groupByArea(
  permissions: readonly string[],
): { area: PermissionArea; permissions: string[] }[] {
  return PERMISSION_AREAS.map((area) => ({
    area,
    permissions: [...permissions]
      .filter(
        (permission) =>
          resourceCopy(splitPermission(permission).resource).area === area,
      )
      .sort(),
  })).filter((group) => group.permissions.length > 0);
}
