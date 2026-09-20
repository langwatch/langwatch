import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Zap } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import {
  PopoverAnchor,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import NextLink from "~/utils/compat/next-link";

/** What the popover says, per surface that needs a model. */
export interface ProviderPrimerCopy {
  title: string;
  body: string;
}

/** The Ask AI composer's words: it cannot run at all without a provider. */
export const ASK_AI_PRIMER_COPY: ProviderPrimerCopy = {
  title: "Connect a model provider",
  body: "Ask AI uses your own model provider keys to translate plain English into trace queries: “errors yesterday from service-x”, “slow checkout traces with eval scores under 0.5”. Add a provider to unlock it.",
};

/**
 * The search bar's words when Enter fell back to a phrase search: the search
 * still ran, and this says what a model would add to it.
 */
export const SMARTER_SEARCH_PRIMER_COPY: ProviderPrimerCopy = {
  title: "Connect a model for smarter search",
  body: "Your words were searched as a phrase. With a model connected, a sentence typed here becomes a filter, a judgement over each trace, or a question for the assistant.",
};

type ProviderPrimerPopoverProps = {
  /** The element the popover opens from (trigger mode) or sits under (anchor mode). */
  children: React.ReactElement;
  copy?: ProviderPrimerCopy;
} & (
  | {
      /** The child opens the popover on click; state lives here. */
      mode?: "trigger";
      open?: undefined;
      onOpenChange?: undefined;
    }
  | {
      /** The caller opens and closes it; the child only positions it. */
      mode: "anchor";
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }
);

/** The words, the icon and the one-click way out of needing them. */
const ProviderPrimerBody: React.FC<{ copy: ProviderPrimerCopy }> = ({
  copy,
}) => (
  <PopoverContent maxWidth="320px">
    <PopoverArrow />
    <PopoverBody>
      <VStack align="stretch" gap={3}>
        <HStack gap={2}>
          <Box
            width="28px"
            height="28px"
            borderRadius="full"
            bg="orange.subtle"
            display="flex"
            alignItems="center"
            justifyContent="center"
            color="orange.fg"
          >
            <Zap size={14} />
          </Box>
          <Text textStyle="sm" fontWeight="semibold">
            {copy.title}
          </Text>
        </HStack>
        <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
          {copy.body}
        </Text>
        <NextLink
          href="/settings/model-providers"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "block" }}
        >
          <Button
            size="xs"
            width="full"
            bg="orange.solid"
            color="white"
            _hover={{ bg: "orange.fg" }}
          >
            Add a provider
          </Button>
        </NextLink>
      </VStack>
    </PopoverBody>
  </PopoverContent>
);

/**
 * Shown where a feature needs a model provider and none is enabled. The point
 * is not to disable the affordance but to say why a provider is needed and
 * link straight to the settings page so setup is one click away. The link
 * opens a new tab so the page the reader was on stays put
 * (dev/docs/best_practices/inline-fix-links.md).
 */
export const ProviderPrimerPopover: React.FC<ProviderPrimerPopoverProps> = (
  props,
) => {
  const { children, copy = ASK_AI_PRIMER_COPY } = props;
  const [ownOpen, setOwnOpen] = useState(false);
  const handleOwnOpenChange = useCallback(
    (e: { open: boolean }) => setOwnOpen(e.open),
    [],
  );
  const anchored = props.mode === "anchor" ? props : null;

  return (
    <PopoverRoot
      open={anchored ? anchored.open : ownOpen}
      onOpenChange={
        anchored
          ? (e: { open: boolean }) => anchored.onOpenChange(e.open)
          : handleOwnOpenChange
      }
      positioning={{ placement: "bottom-start" }}
      lazyMount
      unmountOnExit
    >
      {anchored ? (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <ProviderPrimerBody copy={copy} />
    </PopoverRoot>
  );
};
