/**
 * Your details: the photo and name everybody else sees, and where you stand.
 * Save stands down until the typed name is non-blank and differs from the
 * saved one. Spec: specs/settings/profile.feature
 */

import { Badge, Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import {
  usePersonalToaster,
  useShowErrorToast,
} from "../../behavior/personal-workspace-feedback.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { profileNameMaySave, sanitizeProfileName } from "../../model/profile-name.ts";
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
  const toaster = usePersonalToaster();
  const showErrorToast = useShowErrorToast();
  const savedName = actor?.name ?? "";
  const [name, setName] = useState<string | null>(null);
  const typed = name ?? savedName;
  const sanitized = sanitizeProfileName(typed);

  const updateName = api.user.updateName.useMutation({
    onSuccess: async () => {
      await host.refreshSession();
      setName(null);
      toaster.create({ title: "Name updated", type: "success" });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't update your name" }),
  });

  const maySave = profileNameMaySave({ typed, saved: savedName }) && !updateName.isPending;
  const save = () => {
    if (sanitized !== null && maySave) updateName.mutate({ name: sanitized });
  };

  return (
    <VStack align="start" gap={4} width="full" data-testid="profile-details-section">
      <HStack align="start" gap={6} width="full" flexWrap="wrap">
        {organizationId ? <AvatarUploadControl organizationId={organizationId} /> : null}

        <VStack align="start" gap={3} flex="1" minWidth="240px">
          <Field.Root>
            <Field.Label>Name</Field.Label>
            <Input
              value={typed}
              maxLength={120}
              autoComplete="name"
              placeholder="The name colleagues know you by"
              data-testid="profile-name-input"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  save();
                }
              }}
            />
          </Field.Root>

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

          <Button
            size="sm"
            colorPalette="orange"
            disabled={!maySave}
            loading={updateName.isPending}
            data-testid="profile-name-save"
            onClick={save}
          >
            Save
          </Button>
        </VStack>
      </HStack>
    </VStack>
  );
}
