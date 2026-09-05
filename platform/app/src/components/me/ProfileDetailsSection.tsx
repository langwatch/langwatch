import { Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { UserRound } from "lucide-react";
import { useState } from "react";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { useSession } from "~/utils/auth-client";
import { IdentityChip } from "../access/IdentityRow";
import { SettingsSection } from "../settings/SettingsSection";
import { toaster } from "../ui/toaster";
import { AvatarUploadControl } from "./avatar/AvatarUploadControl";

/**
 * The two things a colleague sees you by: a photo and a name.
 *
 * They belong together because they answer one question — who is this person
 * in a member list — and they were half a screen apart: the photo was
 * editable on a page about personal API keys, and the name was rendered
 * read-only beside it because nothing could write it. Somebody whose identity
 * provider sent "asmith" was "asmith" to every colleague, permanently.
 *
 * THE PHOTO IS THE CONTROL. `AvatarUploadControl` is the photo itself with a
 * pencil on it; there is no second button for it, so the row is a photo and a
 * field rather than a photo, a button and a field.
 *
 * SAVE STANDS DOWN UNTIL THERE IS SOMETHING TO SAVE. An enabled Save on an
 * unchanged form is an invitation to a write that would do nothing, and an
 * enabled Save on an empty one is an invitation to a refusal. Both are said
 * by the control being quiet rather than by a message appearing after the
 * click.
 *
 * Spec: specs/settings/profile.feature
 */
export function ProfileDetailsSection({
  organizationId,
  standing,
}: {
  /** Scopes where the photo is stored. Null before an organization resolves,
   *  and for the rare account that belongs to none: the name is still theirs
   *  to set, so the field stays and only the photo stands down. */
  organizationId: string | null;
  /** Where this person stands in the organization, when there is one. Read
   *  and never editable: your own standing is not yours to change, and the
   *  page that does change it is Members. */
  standing?: { organizationName: string; role: string } | null;
}) {
  const session = useSession();
  const savedName = session.data?.user.name ?? "";
  const email = session.data?.user.email ?? null;
  const [name, setName] = useState<string | null>(null);
  const typed = name ?? savedName;

  const updateName = api.user.updateName.useMutation({
    onSuccess: async () => {
      await session.update();
      setName(null);
      toaster.create({ title: "Name updated", type: "success" });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't update your name" }),
  });

  const trimmed = typed.trim();
  const maySave =
    trimmed !== "" && trimmed !== savedName.trim() && !updateName.isPending;

  return (
    <SettingsSection
      icon={<UserRound size={18} />}
      title="Your details"
      description="How you are shown wherever LangWatch names a person."
      testId="profile-details-settings-section"
    >
      <HStack align="start" gap={6} width="full" flexWrap="wrap">
        {organizationId ? (
          <AvatarUploadControl organizationId={organizationId} />
        ) : null}

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
                if (event.key === "Enter" && maySave) {
                  event.preventDefault();
                  updateName.mutate({ name: trimmed });
                }
              }}
            />
          </Field.Root>

          {/* The address and the standing sit under the field they belong
              beside rather than as fields of their own: neither is changed
              here, and a disabled input is a control that says nothing. */}
          <HStack gap={2} flexWrap="wrap">
            {email && (
              <Text fontSize="sm" color="fg.muted" data-testid="profile-email">
                {email}
              </Text>
            )}
            {standing && (
              <IdentityChip
                label={`${standing.role} of ${standing.organizationName}`}
                data-testid="profile-standing-chip"
              />
            )}
          </HStack>

          {/* THE PRIMARY ACTION, DRESSED AS ONE. Save took the button
              recipe's defaults, which are a grey solid on a grey band: enabled
              it read as a word someone had shaded in, and disabled — the state
              it is in every time the page loads — it read as grey text that
              had been switched off. Both readings are "not a button".
              The filled palette gives it an unmistakable surface in either
              theme, and the disabled state fades that surface rather than
              removing it, so the control stays a control while it waits for
              something to save. */}
          <HStack>
            <Button
              size="sm"
              colorPalette="orange"
              disabled={!maySave}
              loading={updateName.isPending}
              data-testid="profile-name-save"
              onClick={() => updateName.mutate({ name: trimmed })}
            >
              Save
            </Button>
          </HStack>
        </VStack>
      </HStack>
    </SettingsSection>
  );
}
