import { Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { useRef } from "react";

import { Dialog } from "~/components/ui/dialog";

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
}

/**
 * Where a link goes, before it goes there.
 *
 * The host is the headline because it is the one fact the words on a link
 * cannot be trusted for, and Langy's answers are written from data the agent
 * read. The full address sits under it in its own scroll box, so a path long
 * enough to fill a screen can never push the host out of view. The words that
 * were clicked are deliberately absent: repeating them here would give the
 * lie equal billing with the truth.
 */
export function LangyExternalLinkDialog({
  link,
  onCancel,
  onConfirm,
}: LangyExternalLinkDialogProps) {
  // Staying is the safe answer, so it is the one already under the reader's
  // fingers when the dialog opens.
  const stayRef = useRef<HTMLButtonElement>(null);
  // The destination outlives the decision by one closing frame. Tearing the
  // content out the instant the answer arrives would rob the dialog of its own
  // close, and with it the focus it owes back to the link that was clicked.
  const lastLinkRef = useRef<LangyExternalLinkTarget | null>(null);
  if (link) lastLinkRef.current = link;
  const shown = link ?? lastLinkRef.current;

  return (
    <Dialog.Root
      open={!!link}
      onOpenChange={(details) => {
        if (!details.open) onCancel();
      }}
      initialFocusEl={() => stayRef.current}
    >
      {shown ? (
        <Dialog.Content bg="bg" maxWidth="460px" errorScope="Langy link check">
          <Dialog.Header>
            <HStack gap={3} align="center">
              <ExternalLink size={18} />
              <Dialog.Title>This link leaves LangWatch</Dialog.Title>
            </HStack>
          </Dialog.Header>
          <Dialog.Body>
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
              <Dialog.Description fontSize="sm" color="fg.muted">
                A link can read as one place and open another, so check the
                address before you continue.
              </Dialog.Description>
            </VStack>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack width="full">
              <Spacer />
              <Button ref={stayRef} variant="ghost" onClick={onCancel}>
                Stay here
              </Button>
              <Button colorPalette="orange" onClick={onConfirm}>
                <Text truncate maxWidth="200px">
                  Open {shown.host}
                </Text>
                <ExternalLink size={14} />
              </Button>
            </HStack>
          </Dialog.Footer>
        </Dialog.Content>
      ) : null}
    </Dialog.Root>
  );
}
