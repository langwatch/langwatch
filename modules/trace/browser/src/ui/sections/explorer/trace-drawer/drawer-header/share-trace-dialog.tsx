import { Dialog } from "@langwatch/design-system/dialog";
import { Box } from "@langwatch/design-system/primitives";
import { toaster } from "@langwatch/design-system/toaster";
import { useRef } from "react";

import { copyShareLink } from "../../../../../behavior/share/share-links.ts";
import { useShareTrace } from "../../../../../features/trace-drawer/behavior/use-share-trace.ts";
import { ShareTraceDialogBody } from "../../../../blocks/share/share-trace-dialog-body.tsx";
import { showErrorToast } from "../../../errors/index.ts";

/**
 * The share dialog's frame around the mint form and the link list (`ui/blocks/share`):
 * the dialog chrome, the tRPC transport behind it, and how a copy is reported.
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

      showErrorToast({
        fallbackTitle: "Couldn't copy the link",
        description: "Clipboard access is restricted. This can happen on non-HTTPS domains.",
      });
    });
  };

  return (
    // An event boundary: portalled clicks bubble through React, so keep them off the drawer.
    <Box display="contents" onClick={(e) => e.stopPropagation()}>
      <Dialog
        open={open}
        onClose={onClose}
        title="Share trace"
        description="Create a link to this trace. Revoke it at any time."
        surface="glass"
        cancelLabel={null}
        trapFocus={false}
        preventScroll={false}
        contentRef={contentRef}
        initialFocusEl={() => contentRef.current}
      >
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
      </Dialog>
    </Box>
  );
}
