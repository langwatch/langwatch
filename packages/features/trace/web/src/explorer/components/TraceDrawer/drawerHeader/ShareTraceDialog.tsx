import { VStack } from "@chakra-ui/react";
import { copyShareLink, ShareTraceDialogBody } from "@langwatch/share-web";
import { useRef } from "react";
import { Dialog } from "../../../../components/ui/dialog";
import { toaster } from "../../../../components/ui/toaster";
import { useShareTrace } from "../../../hooks/useShareTrace";

/**
 * The share dialog's frame. The body — the mint form and the link list — is
 * `@langwatch/share-web`; this file owns the application's dialog chrome, the
 * tRPC transport behind it, and how a copy is reported.
 */
export function ShareTraceDialog({
  open,
  onClose,
  projectId,
  traceId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | undefined;
  traceId: string;
}) {
  const { links, isLoading, isError, createLink, isCreating, revokeLink, revokingId } =
    useShareTrace({ projectId, traceId, active: open });

  // Park initial focus on the panel itself. Left to its own devices the dialog
  // focuses the close button, which opens with a focus ring drawn around it.
  const contentRef = useRef<HTMLDivElement>(null);

  // Mirrors TraceIdChip's copy: `navigator.clipboard` needs a secure context,
  // so self-hosted plain-http domains get a hint rather than a silent no-op.
  const handleCopy = (url: string) => {
    void copyShareLink(url).then((copied) => {
      if (copied) {
        toaster.create({
          title: "Link copied",
          description: url,
          type: "success",
          duration: 2500,
        });
        return;
      }

      toaster.create({
        title: "Couldn't copy the link",
        description: "Clipboard access is restricted. This can happen on non-HTTPS domains.",
        type: "error",
        duration: 6000,
      });
    });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => !e.open && onClose()}
      initialFocusEl={() => contentRef.current}
    >
      <Dialog.Content
        ref={contentRef}
        tabIndex={-1}
        // Translucent glass surface, matching the drawer. A solid fill here
        // would render the backdrop blur inert.
        background="bg.surface/80"
        backdropFilter="blur(25px)"
        borderRadius="lg"
        _focusVisible={{ outline: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Dialog.CloseTrigger />
        <Dialog.Header paddingBottom={0}>
          <VStack align="start" gap={1}>
            <Dialog.Title>Share trace</Dialog.Title>
            <Dialog.Description color="fg.muted" fontSize="sm">
              Create a link to this trace. Revoke it at any time.
            </Dialog.Description>
          </VStack>
        </Dialog.Header>

        <Dialog.Body paddingTop={5} paddingBottom={6}>
          <ShareTraceDialogBody
            links={links}
            isLoading={isLoading}
            isError={isError}
            canCreate={!!projectId}
            isCreating={isCreating}
            revokingId={revokingId}
            onCreate={createLink}
            onCopy={handleCopy}
            onRevoke={revokeLink}
          />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
