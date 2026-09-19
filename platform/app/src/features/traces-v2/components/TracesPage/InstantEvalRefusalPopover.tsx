import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type React from "react";
import {
  PopoverAnchor,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
} from "~/components/ui/popover";
import NextLink from "~/utils/compat/next-link";
import { formatUsd } from "./InstantEvalConfirmDialog";

/** Why an Instant Eval did not start, and what the popover says about it. */
export type InstantEvalRefusal =
  | {
      kind: "budget";
      question: string;
      spentUsd: number;
      budgetUsd: number;
    }
  | { kind: "model"; question: string };

/** Where a paid plan is picked, which is what lifts the free budget. */
export const UPGRADE_HREF = "/settings/subscription";

/** Where a model provider is connected, which is what a judge runs on. */
export const MODEL_PROVIDERS_HREF = "/settings/model-providers";

interface InstantEvalRefusalPopoverProps {
  refusal: InstantEvalRefusal | null;
  /** Closing, by the X, a click outside or Skip: the phrase search then runs. */
  onClose: () => void;
  children: React.ReactElement;
}

/** The popover's words, exported so the copy is pinned by a test. */
export function instantEvalRefusalCopy(refusal: InstantEvalRefusal): {
  title: string;
  body: string;
  action: { label: string; href: string };
} {
  const found = `An Instant Eval would have read every result and kept the ones where "${refusal.question}", so the table showed the judgement rather than the words.`;
  if (refusal.kind === "budget") {
    return {
      title: "Your free Instant Evals budget is used up",
      body: `${found} This organization has spent ${formatUsd(refusal.spentUsd)} of its ${formatUsd(refusal.budgetUsd)} free budget. Upgrade to keep judging; the words are searched as a phrase in the meantime.`,
      action: { label: "Upgrade", href: UPGRADE_HREF },
    };
  }
  return {
    title: "Configure a model to judge results",
    body: `${found} No judge is configured for this deployment yet, so the words are searched as a phrase instead.`,
    action: { label: "Configure a model", href: MODEL_PROVIDERS_HREF },
  };
}

/**
 * The refusal an Instant Eval met, anchored to the search bar: what the eval
 * would have found here, why it did not run, and the one thing that lifts
 * it. Closable every way, and every way out runs the phrase search, so a
 * spent budget or a missing judge is never an error state on the page.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A refusal is a
 * popover, never an error state").
 */
export const InstantEvalRefusalPopover: React.FC<
  InstantEvalRefusalPopoverProps
> = ({ refusal, onClose, children }) => {
  const copy = refusal ? instantEvalRefusalCopy(refusal) : null;
  return (
    <PopoverRoot
      open={refusal !== null}
      onOpenChange={(e: { open: boolean }) => {
        if (!e.open) onClose();
      }}
      positioning={{ placement: "bottom-start" }}
      lazyMount
      unmountOnExit
    >
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent maxWidth="360px" data-testid="instant-eval-refusal">
        <PopoverArrow />
        <PopoverBody>
          {copy && (
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
                  <Sparkles size={14} />
                </Box>
                <Text textStyle="sm" fontWeight="semibold">
                  {copy.title}
                </Text>
              </HStack>
              <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
                {copy.body}
              </Text>
              <HStack gap={2}>
                <NextLink
                  href={copy.action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "block", flex: 1 }}
                >
                  <Button
                    size="xs"
                    width="full"
                    bg="orange.solid"
                    color="white"
                    _hover={{ bg: "orange.fg" }}
                  >
                    {copy.action.label}
                  </Button>
                </NextLink>
                <Button size="xs" variant="ghost" onClick={onClose}>
                  Skip
                </Button>
              </HStack>
            </VStack>
          )}
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};
