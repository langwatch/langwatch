/**
 * Your details: the photo and name everybody else sees, and where you stand.
 * The only mutation surface for the photo; the name has none yet on this
 * branch (no self-service rename procedure exists here).
 */

import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { AvatarUploadControl } from "./avatar-upload-control.tsx";

/** "Admin", "Guest" or "Member": the words a colleague would use. */
function standingLabel(role: string | undefined): string | null {
  if (role === undefined) return null;
  if (role === "ADMIN") return "Admin";
  if (role === "EXTERNAL") return "Guest";
  return "Member";
}

export function ProfileDetailsSection() {
  const host = usePersonalWorkspaceHost();
  const actor = host.currentUser();
  const organizationId = host.organization()?.id ?? null;
  const standing = standingLabel(host.organizationRole());

  return (
    <VStack align="start" gap={4} width="full" data-testid="profile-details-section">
      <HStack align="start" gap={6} width="full" flexWrap="wrap">
        {organizationId ? <AvatarUploadControl organizationId={organizationId} /> : null}

        <VStack align="start" gap={2} flex="1" minWidth="240px">
          <Text fontSize="lg" fontWeight={600} data-testid="profile-name">
            {actor?.name || "—"}
          </Text>

          <HStack gap={2} flexWrap="wrap">
            {actor?.email && (
              <Text fontSize="sm" color="fg.muted" data-testid="profile-email">
                {actor.email}
              </Text>
            )}
            {standing && (
              <Badge
                variant="surface"
                size="sm"
                colorPalette="gray"
                data-testid="profile-standing-chip"
              >
                {standing}
              </Badge>
            )}
          </HStack>
        </VStack>
      </HStack>
    </VStack>
  );
}
