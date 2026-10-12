// Everything a role can do, read rather than edited, grouped by the part of the
// product it is about; each line carries the sentence and the token (main's RoleDetailDialog).

import { Dialog } from "@langwatch/design-system/dialog";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";

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
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="lg"
      cancelLabel="Close"
    >
      <VStack gap={6} align="stretch">
        <Text fontSize="sm" color="fg.muted">
          {permissions.length} {permissions.length === 1 ? "permission" : "permissions"} across{" "}
          {byArea.length} {byArea.length === 1 ? "area" : "areas"}.
        </Text>

        {byArea.length === 0 ? (
          <Text fontSize="sm" color="fg.subtle">
            This role grants nothing yet. Add permissions by editing the role.
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
    </Dialog>
  );
}
