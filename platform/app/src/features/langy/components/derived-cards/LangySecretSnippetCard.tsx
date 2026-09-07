/**
 * The secret snippet card: a secret shown once, where it can be copied.
 *
 * Langy's `secret_snippet` tool call is where the card hangs; the card is
 * what reads the secret, through `secrets.revealOnce`, on its first render in
 * this tab. The server serves the value once and refuses every later read, so
 * the card has three states and the tool part carries none of them:
 *
 *   reading   the first render, the read in flight; the snippet is masked
 *   shown     this tab read the value; the snippet, filled in, with a copy
 *   gone      the value cannot be read: it was shown already (here, before a
 *             reload, or to another viewer) or the day passed; masked
 *
 * A read that failed for another reason (the network, a server fault) is
 * not a refusal, so that state offers the read again instead of masking.
 *
 * Spec: specs/langy/langy-secret-snippet.feature
 */
import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { CopyButton } from "~/components/CopyButton";
import { describeError, readHandledError } from "~/features/errors";
import { api } from "~/utils/api";

import {
  type LangySecretSnippetCall,
  maskedSecretValue,
  renderSecretSnippet,
} from "../../logic/langySecretSnippetTool";
import { useLangySecretRevealStore } from "../../stores/langySecretRevealStore";

/** The line over a snippet whose value is on screen. */
export const LANGY_SECRET_SHOWN_ONCE_LINE =
  "Shown once. Copy it now, it will not be shown again.";
/** The line over a snippet whose value is gone. */
export const LANGY_SECRET_GONE_LINE =
  "Shown once at creation, not readable again. Create a new key if you did not save it.";
/** The line over a snippet whose read is in flight. */
const LANGY_SECRET_READING_LINE = "Reading the key";

/** The refusals that mean the value is gone for good. */
const GONE_CODES = new Set([
  "secret_already_revealed",
  "secret_reveal_expired",
]);

export interface LangySecretSnippetCardProps {
  /** The organization the key belongs to. Absent = the read cannot start. */
  organizationId: string | null;
  call: LangySecretSnippetCall;
}

export function LangySecretSnippetCard({
  organizationId,
  call,
}: LangySecretSnippetCardProps) {
  const { revealId, template, preview } = call;
  const entry = useLangySecretRevealStore((s) => s.reveals[revealId]);
  const claim = useLangySecretRevealStore((s) => s.claim);
  const shown = useLangySecretRevealStore((s) => s.shown);
  const gone = useLangySecretRevealStore((s) => s.gone);
  const release = useLangySecretRevealStore((s) => s.release);
  const reveal = api.secrets.revealOnce.useMutation();
  const mutate = reveal.mutate;

  // The one read. `claim` is synchronous, so a second mount, a strict-mode
  // double effect or a second card for the same call all find it taken.
  useEffect(() => {
    if (!organizationId) return;
    if (!claim(revealId)) return;
    mutate(
      { organizationId, revealId },
      {
        onSuccess: (revealed) => shown(revealId, revealed.secret),
        onError: (error) => gone(revealId, error),
      },
    );
  }, [organizationId, revealId, claim, mutate, shown, gone]);

  if (entry?.state === "shown") {
    const snippet = renderSecretSnippet({ template, value: entry.secret });
    return (
      <CardShell state="shown">
        <Headline text={LANGY_SECRET_SHOWN_ONCE_LINE} />
        <HStack align="start" gap={1}>
          <Snippet text={snippet} />
          <CopyButton
            value={snippet}
            label="Snippet"
            aria-label="Copy the snippet"
          />
        </HStack>
      </CardShell>
    );
  }

  const masked = renderSecretSnippet({
    template,
    value: maskedSecretValue(preview),
  });

  if (entry?.state === "gone") {
    const handled = readHandledError(entry.error);
    if (handled && GONE_CODES.has(handled.code)) {
      return (
        <CardShell state="gone">
          <Headline text={LANGY_SECRET_GONE_LINE} muted />
          <Snippet text={masked} muted />
        </CardShell>
      );
    }
    return (
      <CardShell state="failed">
        <Text textStyle="xs" color="fg" role="alert">
          {describeError({
            error: entry.error,
            fallbackTitle: "I could not read the key",
          })}
        </Text>
        <Snippet text={masked} muted />
        <Button
          size="xs"
          variant="outline"
          alignSelf="flex-start"
          onClick={() => release(revealId)}
        >
          Try again
        </Button>
      </CardShell>
    );
  }

  return (
    <CardShell state="reading">
      <HStack gap={2}>
        <Spinner size="xs" />
        <Text textStyle="xs" color="fg.muted">
          {LANGY_SECRET_READING_LINE}
        </Text>
      </HStack>
      <Snippet text={masked} muted />
    </CardShell>
  );
}

function Headline({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <HStack gap={2}>
      <Box color={muted ? "fg.muted" : "fg"} display="flex">
        <KeyRound size={14} />
      </Box>
      <Text
        textStyle="xs"
        color={muted ? "fg.muted" : "fg"}
        fontWeight="medium"
      >
        {text}
      </Text>
    </HStack>
  );
}

function Snippet({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <Box
      as="pre"
      data-testid="langy-secret-snippet"
      flex="1"
      minWidth={0}
      margin={0}
      padding={2}
      borderRadius="sm"
      background="bg.muted"
      color={muted ? "fg.muted" : "fg"}
      fontFamily="mono"
      textStyle="xs"
      whiteSpace="pre-wrap"
      wordBreak="break-all"
    >
      {text}
    </Box>
  );
}

function CardShell({
  state,
  children,
}: {
  state: "reading" | "shown" | "gone" | "failed";
  children: ReactNode;
}) {
  return (
    <VStack
      align="stretch"
      gap={2}
      data-testid="langy-secret-snippet-card"
      data-state={state}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      maxWidth="560px"
      background="bg.subtle"
    >
      {children}
    </VStack>
  );
}
