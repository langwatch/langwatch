// What the role will do while it is written, in sentences; the scope picker is a
// lens, since organization-tier grants do nothing from a team (ADR-021; main's RoleEffectPreview).

import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import {
  ScopeChipPicker,
  type ScopeTriadEntry,
  type ScopeTriadType,
} from "@langwatch/design-system/scope-chip-picker";
import { useMemo } from "react";

import {
  permissionSentence,
  permissionsByArea,
  permissionTakesEffectAt,
} from "../../model/role-permissions.ts";
import { PermissionToken } from "../elements/permission-token.tsx";

export function RoleEffectPreview({
  permissions,
  previewScope,
  onPreviewScopeChange,
  organizationId,
  organizationName,
  availableTeams,
  availableProjects,
}: {
  permissions: readonly string[];
  previewScope: ScopeTriadEntry[];
  onPreviewScopeChange: (next: ScopeTriadEntry[]) => void;
  organizationId: string;
  organizationName: string | undefined;
  availableTeams: readonly { id: string; name: string }[];
  availableProjects: readonly { id: string; name: string; teamId: string }[];
}) {
  const scopeType: ScopeTriadType = previewScope[0]?.scopeType ?? "ORGANIZATION";

  const { inForce, inert } = useMemo(() => {
    const sorted = [...permissions].toSorted();
    return {
      inForce: sorted.filter((permission) => permissionTakesEffectAt({ permission, scopeType })),
      inert: sorted.filter((permission) => !permissionTakesEffectAt({ permission, scopeType })),
    };
  }, [permissions, scopeType]);

  const areas = permissionsByArea(inForce);

  return (
    <VStack align="stretch" gap={4} width="full" data-testid="role-preview">
      <Box>
        <Text fontWeight="semibold" fontSize="sm">
          What this role can do
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Kept up to date as you build it.
        </Text>
      </Box>

      <ScopeChipPicker
        value={previewScope}
        onChange={onPreviewScopeChange}
        organizationId={organizationId}
        {...(organizationName ? { organizationName } : {})}
        availableTeams={[...availableTeams]}
        availableProjects={[...availableProjects]}
        label="Preview it assigned on"
        variant="single-select"
        showSummary={false}
      />

      {permissions.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          Nothing yet. Choose what this role should reach, and it will be described here.
        </Text>
      ) : (
        <VStack align="stretch" gap={4}>
          <Text fontSize="xs" color="fg.muted">
            {inForce.length} {inForce.length === 1 ? "permission" : "permissions"} across{" "}
            {areas.length} {areas.length === 1 ? "area" : "areas"}.
          </Text>

          {areas.map(({ area, permissions: areaPermissions }) => (
            <VStack key={area} align="stretch" gap={1.5}>
              <Text
                fontSize="xs"
                fontWeight="semibold"
                letterSpacing="wide"
                textTransform="uppercase"
                color="fg.muted"
              >
                {area}
              </Text>
              {areaPermissions.map((permission) => (
                <HStack key={permission} gap={2} align="baseline">
                  <Text fontSize="sm">{permissionSentence(permission)}</Text>
                  <PermissionToken permission={permission} />
                </HStack>
              ))}
            </VStack>
          ))}

          {inert.length > 0 && (
            <VStack
              align="stretch"
              gap={1.5}
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
              padding={3}
              data-testid="role-preview-inert"
            >
              <Text fontSize="xs" color="fg.muted">
                {inert.length === 1
                  ? "This permission grants nothing here. It takes effect only where the role is assigned on the organization."
                  : "These permissions grant nothing here. They take effect only where the role is assigned on the organization."}
              </Text>
              <HStack gap={1.5} flexWrap="wrap">
                {inert.map((permission) => (
                  <PermissionToken key={permission} permission={permission} muted />
                ))}
              </HStack>
            </VStack>
          )}
        </VStack>
      )}
    </VStack>
  );
}
