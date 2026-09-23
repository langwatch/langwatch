import { Separator, VStack } from "@chakra-ui/react";

import type { ShareLinkView } from "../../../model/share/share-link-status.ts";
import { CreateShareLinkForm, type CreateShareLinkDraft } from "./create-share-link-form.tsx";
import { ShareLinksList } from "./share-links-list.tsx";

/**
 * The host retains its Dialog behavior: untrapped focus, blurred backdrop,
 * and the error boundary around this body.
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
  links: ShareLinkView[];
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
