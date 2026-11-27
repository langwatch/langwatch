// Everything a role can do, grouped by the part of the product it is about; each line
// carries the sentence and the token.

import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import { permissionSentence, permissionsByArea } from "../../model/role-permissions.ts";
import { PermissionToken } from "../elements/permission-token.tsx";
import { SectionEyebrow } from "../elements/section-eyebrow.tsx";

export function RolePermissionAreas({ permissions }: { permissions: readonly string[] }) {
  const byArea = permissionsByArea(permissions);

  if (byArea.length === 0) {
    return (
      <Text textStyle="bodySm" color="fg.subtle">
        This role grants nothing yet. Add permissions by editing the role.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={5} data-testid="role-permission-areas">
      <Text textStyle="bodySm" color="fg.muted">
        {permissions.length} {permissions.length === 1 ? "permission" : "permissions"} across{" "}
        {byArea.length} {byArea.length === 1 ? "area" : "areas"}.
      </Text>
      {byArea.map(({ area, permissions: areaPermissions }) => (
        <VStack key={area} align="stretch" gap={2}>
          <SectionEyebrow>{area}</SectionEyebrow>
          <VStack align="stretch" gap={1.5}>
            {areaPermissions.map((permission) => (
              <HStack key={permission} gap={3} align="center">
                <Box minWidth="150px" flexShrink={0}>
                  <PermissionToken permission={permission} />
                </Box>
                <Text textStyle="bodySm" color="fg">
                  {permissionSentence(permission)}
                </Text>
              </HStack>
            ))}
          </VStack>
        </VStack>
      ))}
    </VStack>
  );
}
