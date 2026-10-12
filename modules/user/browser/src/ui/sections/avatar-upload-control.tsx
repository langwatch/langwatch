import { UserAvatar } from "@langwatch/design-system/avatar";
import { Dialog } from "@langwatch/design-system/dialog";
import { chakra, Box, Center, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useProductAccent } from "@langwatch/design-system/use-product-accent";
import { Info, Pencil } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import {
  usePersonalToaster,
  useShowErrorToast,
} from "../../behavior/personal-workspace-feedback.ts";
import { useCurrentUser } from "../../behavior/personal-workspace-session.ts";
import {
  PERSONAL_WORKSPACE_WAIT_HINT,
  usePersonalWorkspaceWait,
} from "../../behavior/use-personal-workspace-wait.ts";
import { useUserAvatarUrl } from "../../behavior/use-user-avatar-url.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";
import { processAvatarImage } from "../../model/process-avatar-image.ts";

const FORMAT_HINT = "PNG, JPG, WEBP or GIF, up to 8 MB. Cropped to a square.";

/** The photo as the edit control — a pencil badge overlays it; click opens the dialog. */
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
  const src = useUserAvatarUrl(image);
  const accent = useProductAccent();
  return (
    <chakra.button
      position="relative"
      type="button"
      disabled={isDisabled}
      aria-label={label}
      aria-disabled={isDisabled}
      cursor={isDisabled ? "default" : "pointer"}
      transition="opacity 0.15s"
      _hover={isDisabled ? undefined : { opacity: 0.85 }}
      onClick={isDisabled ? undefined : onOpen}
    >
      <UserAvatar name={name} src={src} size="xl" borderWidth="1px" borderColor="border.muted" />
      <Box
        position="absolute"
        bottom="0"
        right="0"
        width="18px"
        height="18px"
        bg={accent.roles.solid}
        color={accent.roles.contrast}
        borderRadius="full"
        borderWidth="2px"
        borderColor="bg.surface"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Pencil size={9} />
      </Box>
    </chakra.button>
  );
}

/** LinkedIn-style "Profile photo" dialog — view the photo large, then change it. */
function AvatarPhotoDialog({
  isOpen,
  onOpenChange,
  name,
  image,
  hasImage,
  hasPreview,
  isBusy,
  isSaving,
  isRemoving,
  waiting,
  onChange,
  onRemove,
  onSave,
  onCancel,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  name: string | null;
  image: string | null;
  hasImage: boolean;
  hasPreview: boolean;
  isBusy: boolean;
  isSaving: boolean;
  isRemoving: boolean;
  waiting: boolean;
  onChange: () => void;
  onRemove: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const src = useUserAvatarUrl(image);
  const removeAction = hasImage
    ? ({ label: "Remove", tone: "danger", onClick: onRemove, loading: isRemoving } as const)
    : void 0;
  const secondaryAction = hasPreview ? { label: "Cancel", onClick: onCancel } : removeAction;
  return (
    <Dialog
      open={isOpen}
      onClose={() => onOpenChange(false)}
      title="Profile photo"
      busy={isBusy}
      cancelLabel={null}
      secondaryAction={secondaryAction}
      primaryAction={
        hasPreview
          ? {
              label: "Save photo",
              onClick: onSave,
              loading: isSaving,
              disabledReason: waiting ? PERSONAL_WORKSPACE_WAIT_HINT : void 0,
            }
          : { label: hasImage ? "Change photo" : "Upload photo", onClick: onChange }
      }
    >
      <Center py={2}>
        <UserAvatar
          name={name}
          src={src}
          width="180px"
          height="180px"
          borderWidth="1px"
          borderColor="border.muted"
        />
      </Center>
      {waiting && (
        <Text fontSize="xs" color="fg.muted" textAlign="center" as="output" display="block">
          {PERSONAL_WORKSPACE_WAIT_HINT}
        </Text>
      )}
    </Dialog>
  );
}

/**
 * Avatar upload control for profile settings.
 */
export function AvatarUploadControl({ organizationId }: { organizationId: string }) {
  const host = usePersonalWorkspaceHost();
  const actor = useCurrentUser();
  const toaster = usePersonalToaster();
  const showErrorToast = useShowErrorToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const currentImage = actor?.image ?? null;
  const name = actor?.name ?? actor?.email ?? null;

  const workspaceWait = usePersonalWorkspaceWait({ organizationId });
  const setAvatar = api.user.setAvatar.useMutation({
    onSuccess: async () => {
      await host.refreshSession();
      setPreview(null);
      setIsOpen(false);
      toaster.create({ title: "Photo updated", type: "success" });
    },
    onError: (error) => {
      if (workspaceWait.absorb(error)) return;
      showErrorToast({ error, fallbackTitle: "Couldn't update photo" });
    },
  });

  const removeAvatar = api.user.removeAvatar.useMutation({
    onSuccess: async () => {
      await host.refreshSession();
      setPreview(null);
      toaster.create({ title: "Photo removed", type: "success" });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't remove photo" }),
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
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't read that image",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <HStack gap={2.5} align="center">
        <AvatarEditButton
          name={name}
          image={currentImage}
          label={currentImage ? "Edit profile photo" : "Add profile photo"}
          isDisabled={isBusy}
          onOpen={() => setIsOpen(true)}
        />
        <Tooltip content={FORMAT_HINT} positioning={{ placement: "right" }}>
          <Box display="inline-flex" color="fg.muted" aria-label={FORMAT_HINT}>
            <Info size={16} />
          </Box>
        </Tooltip>
      </HStack>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={(e) => void onFilePicked(e.target.files?.[0])}
      />

      <AvatarPhotoDialog
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (isBusy) return;
          setIsOpen(open);
          if (!open) setPreview(null);
        }}
        name={name}
        image={preview ?? currentImage}
        hasImage={!!currentImage}
        hasPreview={!!preview}
        isBusy={isBusy}
        isSaving={setAvatar.isPending}
        isRemoving={removeAvatar.isPending}
        waiting={workspaceWait.waiting}
        onChange={() => fileInputRef.current?.click()}
        onRemove={() => removeAvatar.mutate({})}
        onSave={() => {
          if (preview) setAvatar.mutate({ organizationId, imageDataUrl: preview });
        }}
        onCancel={() => setPreview(null)}
      />
    </>
  );
}
