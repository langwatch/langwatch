import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import {
  ScopeChipPicker,
  type ScopeTriadEntry,
  type ScopeTriadType,
} from "../settings/ScopeChipPicker";
import { PermissionToken } from "./PermissionToken";
import {
  PERMISSION_AREAS,
  type PermissionArea,
  permissionSentence,
  permissionTakesEffectAt,
  resourceCopy,
  splitPermission,
} from "./rolePermissions";

/**
 * What this role will be able to do, while it is still being written.
 *
 * A permission list is not an answer to "what will this person be able to do"
 * — it is the raw material for one, and the reader is being asked to sign off
 * on the answer. So the preview keeps up as the role is built, in sentences,
 * grouped the way the product is.
 *
 * The scope picker here is a lens, not a setting: a role definition carries no
 * scope, the assignment does. It is worth offering because the answer really
 * does depend on it — organization-tier permissions grant nothing at all from
 * a team or project assignment (ADR-021), so a role written for a project team
 * with `governance:manage` in it is a role that will silently do less than its
 * author believes. Better to say so here than to have somebody find out.
 */
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
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
}) {
  const scopeType: ScopeTriadType =
    previewScope[0]?.scopeType ?? "ORGANIZATION";

  const { inForce, inert } = useMemo(() => {
    const sorted = [...permissions].sort();
    return {
      inForce: sorted.filter((permission) =>
        permissionTakesEffectAt({ permission, scopeType }),
      ),
      inert: sorted.filter(
        (permission) => !permissionTakesEffectAt({ permission, scopeType }),
      ),
    };
  }, [permissions, scopeType]);

  const areas = groupByArea(inForce);

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
        organizationName={organizationName}
        availableTeams={availableTeams}
        availableProjects={availableProjects}
        label="Preview it assigned on"
        variant="single-select"
        showSummary={false}
      />

      {permissions.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          Nothing yet. Choose what this role should reach, and it will be
          described here.
        </Text>
      ) : (
        <VStack align="stretch" gap={4}>
          <Text fontSize="xs" color="fg.muted">
            {inForce.length}{" "}
            {inForce.length === 1 ? "permission" : "permissions"} across{" "}
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
                  <PermissionToken
                    key={permission}
                    permission={permission}
                    muted
                  />
                ))}
              </HStack>
            </VStack>
          )}
        </VStack>
      )}
    </VStack>
  );
}

function groupByArea(
  permissions: readonly string[],
): { area: PermissionArea; permissions: string[] }[] {
  return PERMISSION_AREAS.map((area) => ({
    area,
    permissions: permissions.filter(
      (permission) =>
        resourceCopy(splitPermission(permission).resource).area === area,
    ),
  })).filter((group) => group.permissions.length > 0);
}
