import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { UserAvatar } from "~/components/UserAvatar";
import { toaster } from "~/components/ui/toaster";
import { useSession } from "~/utils/auth-client";
import { api } from "~/utils/api";
import { AvatarImageError, processAvatarImage } from "./processAvatarImage";

/** The photo itself as the edit control — a pencil badge overlays it. */
function AvatarEditButton({
  name,
  image,
  label,
  isDisabled,
  onOpen,
}: {
  name: string | null;
  image: string | null;
  label: string;
  isDisabled: boolean;
  onOpen: () => void;
}) {
  return (
    <Box
      position="relative"
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-label={label}
      cursor={isDisabled ? "default" : "pointer"}
      transition="opacity 0.15s"
      _hover={isDisabled ? undefined : { opacity: 0.85 }}
      onClick={isDisabled ? undefined : onOpen}
      onKeyDown={(e) => {
        if (!isDisabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <UserAvatar
        name={name}
        image={image}
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
  );
}

/** Save/Cancel while previewing a pick, or Remove when a photo is already set. */
function AvatarActions({
  hasPreview,
  hasImage,
  isBusy,
  isSaving,
  isRemoving,
  onSave,
  onCancel,
  onRemove,
}: {
  hasPreview: boolean;
  hasImage: boolean;
  isBusy: boolean;
  isSaving: boolean;
  isRemoving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  if (hasPreview) {
    return (
      <HStack gap={2}>
        <Button size="sm" onClick={onSave} loading={isSaving} disabled={isBusy}>
          Save photo
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
      </HStack>
    );
  }
  if (hasImage) {
    return (
      <Button
        size="sm"
        variant="ghost"
        colorPalette="red"
        onClick={onRemove}
        loading={isRemoving}
        disabled={isBusy}
      >
        Remove
      </Button>
    );
  }
  return null;
}

/**
 * Profile-settings control to upload, preview, and remove the user's own avatar
 * photo. The avatar itself is the edit affordance (a pencil badge sits on it);
 * clicking it opens the file picker. The photo flows to every avatar surface
 * via `User.image`. `organizationId` scopes the personal-workspace the photo is
 * stored under.
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
  const [isProcessing, setIsProcessing] = useState(false);

  const currentImage = session.data?.user.image ?? null;
  const name = session.data?.user.name ?? session.data?.user.email ?? null;

  const setAvatar = api.user.setAvatar.useMutation({
    onSuccess: async () => {
      await session.update();
      setPreview(null);
      toaster.create({ title: "Photo updated", type: "success" });
    },
    onError: (err) =>
      toaster.create({
        title: "Couldn't update photo",
        description: err.message,
        type: "error",
      }),
  });

  const removeAvatar = api.user.removeAvatar.useMutation({
    onSuccess: async () => {
      await session.update();
      setPreview(null);
      toaster.create({ title: "Photo removed", type: "success" });
    },
    onError: (err) =>
      toaster.create({
        title: "Couldn't remove photo",
        description: err.message,
        type: "error",
      }),
  });

  const isBusy = isProcessing || setAvatar.isPending || removeAvatar.isPending;

  const onFilePicked = async (file: File | undefined) => {
    // Allow re-selecting the same file later by clearing the input value.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setIsProcessing(true);
    try {
      setPreview(await processAvatarImage(file));
    } catch (err) {
      toaster.create({
        title: "Couldn't read that image",
        description:
          err instanceof AvatarImageError
            ? err.message
            : "Please try another file.",
        type: "error",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <HStack gap={4} align="center">
      <AvatarEditButton
        name={name}
        image={preview ?? currentImage}
        label={currentImage ? "Change photo" : "Upload photo"}
        isDisabled={isBusy}
        onOpen={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={(e) => void onFilePicked(e.target.files?.[0])}
      />

      <VStack align="start" gap={2}>
        <AvatarActions
          hasPreview={!!preview}
          hasImage={!!currentImage}
          isBusy={isBusy}
          isSaving={setAvatar.isPending}
          isRemoving={removeAvatar.isPending}
          onSave={() => {
            if (preview) setAvatar.mutate({ organizationId, imageDataUrl: preview });
          }}
          onCancel={() => setPreview(null)}
          onRemove={() => removeAvatar.mutate({})}
        />
        <Text fontSize="xs" color="fg.muted">
          PNG, JPG, WEBP or GIF, up to 8 MB. Cropped to a square.
        </Text>
      </VStack>
    </HStack>
  );
}
