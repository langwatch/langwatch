import { Separator, VStack } from "@chakra-ui/react";
import type { ShareLink } from "@langwatch/share-contract";
import { CreateShareLinkForm, type CreateShareLinkDraft } from "./create-share-link-form";
import { ShareLinksList } from "./share-links-list";

/**
 * Everything inside the share dialog's frame.
 *
 * The frame itself stays with the host: the application's Dialog wrapper
 * carries behaviour this package must not restate (untrapped focus, the one
 * transparent blurred backdrop, the isolated error boundary around the body).
 */
export function ShareTraceDialogBody({
  links,
  isLoading,
  isError,
  canCreate,
  isCreating,
  revokingId,
  onCreate,
  onCopy,
  onRevoke,
}: {
  links: ShareLink[];
  isLoading: boolean;
  isError: boolean;
  canCreate: boolean;
  isCreating: boolean;
  revokingId: string | null;
  onCreate: (draft: CreateShareLinkDraft) => void;
  onCopy: (url: string) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <VStack gap={6} align="stretch">
      <CreateShareLinkForm canCreate={canCreate} isCreating={isCreating} onCreate={onCreate} />

      <Separator />

      <ShareLinksList
        links={links}
        isLoading={isLoading}
        isError={isError}
        revokingId={revokingId}
        onCopy={onCopy}
        onRevoke={onRevoke}
      />
    </VStack>
  );
}
