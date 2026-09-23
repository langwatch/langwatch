/**
 * The secret snippet card: a secret shown once, where it can be copied. It reads the secret
 * through `secrets.revealOnce` on its first render in this tab and is masked on every later one.
 * Spec: specs/langy/langy-secret-snippet.feature
 */
import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { describeError, readHandledError } from "../../../behavior/errors.tsx";
import { api } from "../../../behavior/langy-api.ts";
import { useLangySecretRevealStore } from "../../../behavior/langy-secret-reveal.store.ts";
import {
  type LangySecretSnippetCall,
  maskedSecretValue,
  renderSecretSnippet,
} from "../../../model/langy-secret-snippet-tool.ts";
import { LangyCopyButton } from "../../elements/langy-copy-button.tsx";

/** The line over a snippet whose value is on screen. */
export const LANGY_SECRET_SHOWN_ONCE_LINE = "Shown once. Copy it now, it will not be shown again.";
/** The line over a snippet whose value is gone. */
export const LANGY_SECRET_GONE_LINE =
  "Shown once at creation, not readable again. Create a new key if you did not save it.";
const LANGY_SECRET_READING_LINE = "Reading the key";

/** The refusals that mean the value is gone for good. */
const GONE_CODES = new Set(["secret_already_revealed", "secret_reveal_expired"]);

export interface LangySecretSnippetCardProps {
  /** The organization the key belongs to. Absent = the read cannot start. */
  organizationId: string | null;
  call: LangySecretSnippetCall;
}

export function LangySecretSnippetCard({ organizationId, call }: LangySecretSnippetCardProps) {
  const { revealId, template, preview } = call;
  const entry = useLangySecretRevealStore((s) => s.reveals[revealId]);
  const claim = useLangySecretRevealStore((s) => s.claim);
  const shown = useLangySecretRevealStore((s) => s.shown);
  const gone = useLangySecretRevealStore((s) => s.gone);
  const release = useLangySecretRevealStore((s) => s.release);
  const { mutate } = api.secrets.revealOnce.useMutation();
  const unclaimed = entry === undefined;

  // The one read. `claim` is synchronous, so a second mount, a strict-mode double effect or a
  // second card for the same call all find it taken; a released failure re-arms it.
  useEffect(() => {
    if (!organizationId || !unclaimed) return;
    if (!claim(revealId)) return;
    mutate(
      { organizationId, revealId },
      {
        onSuccess: (revealed: { secret: string }) => shown(revealId, revealed.secret),
        onError: (error: unknown) => gone(revealId, error),
      },
    );
  }, [organizationId, revealId, unclaimed, claim, mutate, shown, gone]);

  if (entry?.state === "shown") {
    const snippet = renderSecretSnippet({ template, value: entry.secret });
    return (
      <CardShell state="shown">
        <Headline text={LANGY_SECRET_SHOWN_ONCE_LINE} />
        <HStack align="start" gap={1}>
          <Snippet text={snippet} />
          <LangyCopyButton value={snippet} label="The snippet" />
        </HStack>
      </CardShell>
    );
  }

  const masked = renderSecretSnippet({ template, value: maskedSecretValue(preview) });

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
          {describeError({ error: entry.error, fallbackTitle: "I could not read the key" })}
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
      <Text textStyle="xs" color={muted ? "fg.muted" : "fg"} fontWeight="medium">
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
