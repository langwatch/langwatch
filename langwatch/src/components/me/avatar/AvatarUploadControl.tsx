import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { UserAvatar } from "~/components/UserAvatar";
import { toaster } from "~/components/ui/toaster";
import { useSession } from "~/utils/auth-client";
import { api } from "~/utils/api";
import { AvatarImageError, processAvatarImage } from "./processAvatarImage";

/**
 * Profile-settings control to upload, preview, and remove the user's own avatar
 * photo. The avatar itself is the edit affordance — a pencil badge sits on the
 * photo and clicking it opens the file picker. The photo flows to every avatar
 * surface via `User.image`.
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

  const openPicker = () => {
    if (!busy) fileInputRef.current?.click();
  };

  return (
    <HStack gap={4} align="center">
      {/* The photo IS the edit control — a pencil badge overlays it. */}
      <Box
        position="relative"
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label={currentImage ? "Change photo" : "Upload photo"}
        cursor={busy ? "default" : "pointer"}
        transition="opacity 0.15s"
        _hover={busy ? undefined : { opacity: 0.85 }}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (!busy && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openPicker();
          }
        }}
      >
        <UserAvatar
          name={name}
          image={preview ?? currentImage}
          size="xl"
          borderWidth="1px"
          borderColor="border.muted"
        />
        <Box
          position="absolute"
          bottom="0"
          right="0"
          width="24px"
          height="24px"
          bg="blue.500"
          color="white"
          borderRadius="full"
          borderWidth="2px"
          borderColor="bg.surface"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Pencil size={12} />
        </Box>
      </Box>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={(e) => void onFilePicked(e.target.files?.[0])}
      />

      <VStack align="start" gap={2}>
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
          currentImage && (
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
          )
        )}

        <Text fontSize="xs" color="fg.muted">
          PNG, JPG, WEBP or GIF, up to 1 MB. Cropped to a square.
        </Text>
      </VStack>
    </HStack>
  );
}
