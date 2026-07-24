import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useRef, useState } from "react";
import { UserAvatar } from "~/components/UserAvatar";
import { toaster } from "~/components/ui/toaster";
import { useSession } from "~/utils/auth-client";
import { api } from "~/utils/api";
import { AvatarImageError, processAvatarImage } from "./processAvatarImage";

/**
 * Profile-settings control to upload, preview, and remove the user's own avatar
 * photo. The photo flows to every avatar surface via `User.image`.
 *
 * `organizationId` scopes the personal-workspace the photo is stored under.
 *
 * Spec: specs/settings/user-avatar.feature
 */
export function AvatarUploadControl({
  organizationId,
}: {
  organizationId: string;
}) {
  const session = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const currentImage = session.data?.user.image ?? null;
  const name = session.data?.user.name ?? session.data?.user.email ?? null;

  const setAvatar = api.user.setAvatar.useMutation({
    onSuccess: async () => {
      await session.update();
      setPreview(null);
      toaster.create({ title: "Photo updated", type: "success" });
    },
    onError: (err) => {
      toaster.create({
        title: "Couldn't update photo",
        description: err.message,
        type: "error",
      });
    },
  });

  const removeAvatar = api.user.removeAvatar.useMutation({
    onSuccess: async () => {
      await session.update();
      setPreview(null);
      toaster.create({ title: "Photo removed", type: "success" });
    },
    onError: (err) => {
      toaster.create({
        title: "Couldn't remove photo",
        description: err.message,
        type: "error",
      });
    },
  });

  const busy = processing || setAvatar.isPending || removeAvatar.isPending;

  const onFilePicked = async (file: File | undefined) => {
    // Allow re-selecting the same file later by clearing the input value.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setProcessing(true);
    try {
      setPreview(await processAvatarImage(file));
    } catch (err) {
      toaster.create({
        title: "Couldn't read that image",
        description:
          err instanceof AvatarImageError ? err.message : "Please try another file.",
        type: "error",
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <HStack gap={4} align="center">
      <UserAvatar
        name={name}
        image={preview ?? currentImage}
        size="xl"
        borderWidth="1px"
        borderColor="border.muted"
      />

      <VStack align="start" gap={2}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={(e) => void onFilePicked(e.target.files?.[0])}
        />

        {preview ? (
          <HStack gap={2}>
            <Button
              size="sm"
              onClick={() =>
                setAvatar.mutate({ organizationId, imageDataUrl: preview })
              }
              loading={setAvatar.isPending}
              disabled={busy}
            >
              Save photo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPreview(null)}
              disabled={busy}
            >
              Cancel
            </Button>
          </HStack>
        ) : (
          <HStack gap={2}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              loading={processing}
              disabled={busy}
            >
              {currentImage ? "Change photo" : "Upload photo"}
            </Button>
            {currentImage && (
              <Button
                size="sm"
                variant="ghost"
                colorPalette="red"
                onClick={() => removeAvatar.mutate({})}
                loading={removeAvatar.isPending}
                disabled={busy}
              >
                Remove
              </Button>
            )}
          </HStack>
        )}

        <Box>
          <Text fontSize="xs" color="fg.muted">
            PNG, JPG, WEBP or GIF. Cropped to a square.
          </Text>
        </Box>
      </VStack>
    </HStack>
  );
}
