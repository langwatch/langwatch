import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Text, VStack } from "@langwatch/design-system/primitives";
import { ExternalLink } from "lucide-react";
import { useRef } from "react";

export interface LangyExternalLinkTarget {
  /** The full address, as the URL parser resolved it. */
  url: string;
  /** The host the browser will actually contact. */
  host: string;
}

export interface LangyExternalLinkDialogProps {
  /** The destination waiting on the customer's decision; null when nothing is. */
  link: LangyExternalLinkTarget | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Where focus goes when the dialog closes: the link that was clicked. */
  finalFocusEl?: () => HTMLElement | null;
}

/**
 * Where a link goes, before it goes there.
 */
export function LangyExternalLinkDialog({
  link,
  onCancel,
  onConfirm,
  finalFocusEl,
}: LangyExternalLinkDialogProps) {
  // The destination outlives the decision by one closing frame. Tearing the
  // content out the instant the answer arrives would rob the dialog of its own
  // close, and with it the focus it owes back to the link that was clicked.
  const lastLinkRef = useRef<LangyExternalLinkTarget | null>(null);
  if (link) lastLinkRef.current = link;
  const shown = link ?? lastLinkRef.current;

  return (
    // Staying is the safe answer, so it is the one already under the reader's
    // fingers when the dialog opens.
    <Dialog
      open={!!link}
      onClose={onCancel}
      title="This link leaves LangWatch"
      icon={<ExternalLink size={18} />}
      description="A link can read as one place and open another, so check the address before you continue."
      initialFocus="secondary"
      finalFocusEl={finalFocusEl}
      secondaryAction={{ label: "Stay here", onClick: onCancel }}
      primaryAction={
        shown
          ? {
              label: `Open ${shown.host}`,
              icon: <ExternalLink size={14} />,
              onClick: onConfirm,
            }
          : undefined
      }
      errorScope="Langy link check"
    >
      {shown ? (
        <VStack align="stretch" gap={3}>
          <Box>
            <Text
              textStyle="2xs"
              fontWeight="600"
              letterSpacing="0.08em"
              textTransform="uppercase"
              color="fg.muted"
            >
              It opens
            </Text>
            <Text
              data-testid="langy-external-link-host"
              fontSize="lg"
              fontWeight="700"
              lineHeight="1.3"
              wordBreak="break-all"
              color="fg"
            >
              {shown.host}
            </Text>
          </Box>
          <Box
            // The address gets its own scroll box: however long the rest of
            // it runs, it cannot shove the host off the top of the dialog.
            maxHeight="4.5em"
            overflowY="auto"
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={2}
            background="bg.subtle"
          >
            <Text
              data-testid="langy-external-link-url"
              fontFamily="mono"
              fontSize="xs"
              color="fg.muted"
              wordBreak="break-all"
            >
              {shown.url}
            </Text>
          </Box>
        </VStack>
      ) : null}
    </Dialog>
  );
}
