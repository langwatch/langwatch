import { Box, Button, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import type { UIMessage } from "ai";
import { ArrowRight, Check } from "lucide-react";
import type React from "react";
import { Markdown } from "~/components/Markdown";
import {
  AI_SHADOW,
  GradientSparkle,
  MeshGradientLayer,
  SparkleTile,
} from "~/features/traces-v2/components/ai/aiBrandVisuals";
import { extractGithubPrLinks } from "~/server/services/langy/githubPrLinks";
import { parseGithubProgressEvents } from "~/server/services/langy/githubProgressEvents";
import { CONNECT_GITHUB_SENTINEL } from "~/server/services/langy/langySentinels";
import { LangyGitHubConnectCard } from "./github/LangyGitHubConnectCard";
import { LangyGitHubPrCard } from "./github/LangyGitHubPrCard";
import { LangyGitHubProgressCard } from "./github/LangyGitHubProgressCard";

export interface LangyProposal {
  langyProposal: true;
  kind: string;
  summary: string;
  rationale?: string;
  destructive?: boolean;
  payload: Record<string, unknown>;
}

export type AppliedOutcome = {
  label?: string;
  onOpen?: () => void;
  href?: string;
} | void;

export type ProposalHandlers = Record<
  string,
  (payload: Record<string, unknown>) => Promise<AppliedOutcome>
>;

export function MessageContent({
  message,
  organizationId,
  appliedOutcomes,
  discardedProposals,
  applyingProposals,
  onApply,
  onDiscard,
  onConnectedGithub,
}: {
  message: UIMessage;
  organizationId?: string | null;
  appliedOutcomes: Record<
    string,
    { href?: string; label?: string; onOpen?: () => void }
  >;
  discardedProposals: Set<string>;
  applyingProposals: Set<string>;
  onApply: (proposalId: string, proposal: LangyProposal) => Promise<void>;
  onDiscard: (proposalId: string) => void;
  onConnectedGithub?: (login: string) => void;
}) {
  const isUser = message.role === "user";
  const rawText = message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("");

  const showConnectCard = !isUser && rawText.includes(CONNECT_GITHUB_SENTINEL);
  const afterConnectStrip = showConnectCard
    ? rawText.split(CONNECT_GITHUB_SENTINEL).join("").trim()
    : rawText;

  // Strip [langy:progress:...] sentinels from the rendered text and surface
  // them as a steps card above the prose. Skipping for user messages.
  const progress = isUser
    ? { events: [], cleanedText: afterConnectStrip }
    : parseGithubProgressEvents(afterConnectStrip);
  const text = progress.cleanedText;

  const proposals = extractProposals(message);
  const prLinks = isUser ? [] : extractGithubPrLinks(text);
  if (
    !text &&
    proposals.length === 0 &&
    !showConnectCard &&
    prLinks.length === 0 &&
    progress.events.length === 0
  )
    return null;

  if (isUser) {
    return (
      <Box alignSelf="flex-end" maxWidth="85%">
        <Box
          paddingX={3}
          paddingY={2}
          background="#1c1917"
          color="white"
          borderRadius="lg"
          borderBottomRightRadius="sm"
          textStyle="sm"
          lineHeight="1.45"
          whiteSpace="pre-wrap"
        >
          {text}
        </Box>
      </Box>
    );
  }

  return (
    <HStack gap={2} align="flex-start" width="full">
      <SparkleTile size={24} sparkleSize={12} />
      <VStack align="stretch" gap={2.5} flex={1} minWidth={0}>
        {text && (
          <Box
            textStyle="sm"
            color="fg"
            lineHeight="1.55"
            css={{
              "& p": { margin: 0 },
              "& p + p": { marginTop: "6px" },
              "& ul, & ol": { paddingLeft: "18px", margin: "4px 0" },
              "& code": {
                fontSize: "12px",
                padding: "1px 5px",
                borderRadius: "4px",
                background: "var(--chakra-colors-bg-subtle)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              },
            }}
          >
            <Markdown>{text}</Markdown>
          </Box>
        )}
        {showConnectCard && organizationId ? (
          <LangyGitHubConnectCard
            organizationId={organizationId}
            onConnected={onConnectedGithub}
          />
        ) : null}
        {progress.events.length > 0 && (
          <LangyGitHubProgressCard events={progress.events} />
        )}
        {prLinks.map((pr) => (
          <LangyGitHubPrCard
            key={`${pr.owner}/${pr.repo}#${pr.number}`}
            {...pr}
          />
        ))}
        {proposals.map(({ id, proposal }) => (
          <ProposalCard
            key={id}
            proposal={proposal}
            appliedOutcome={appliedOutcomes[id]}
            isDiscarded={discardedProposals.has(id)}
            isApplying={applyingProposals.has(id)}
            onApply={() => void onApply(id, proposal)}
            onDiscard={() => onDiscard(id)}
          />
        ))}
      </VStack>
    </HStack>
  );
}

function ProposalCard({
  proposal,
  appliedOutcome,
  isDiscarded,
  isApplying,
  onApply,
  onDiscard,
}: {
  proposal: LangyProposal;
  appliedOutcome?: { href?: string; label?: string; onOpen?: () => void };
  isDiscarded: boolean;
  isApplying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const isApplied = !!appliedOutcome;
  const destructive = !!proposal.destructive;
  const openHref = appliedOutcome?.href;
  const onOpen = appliedOutcome?.onOpen;
  const openLabel = appliedOutcome?.label ?? "Open";
  const hasOpen = !!onOpen || !!openHref;

  // Resolve overline copy + colour up front so the JSX below doesn't read
  // like a five-deep nested ternary. Each branch states one thing.
  const overlineLabel = (() => {
    if (isApplied) return destructive ? "Done" : "Applied";
    if (isDiscarded) return "Discarded";
    if (isApplying) return destructive ? "Deleting…" : "Applying…";
    return destructive ? "Wants to delete" : "Proposal";
  })();

  const overlineColor = (() => {
    if (destructive && !isApplied) return "var(--chakra-colors-red-fg)";
    if (isApplied && !destructive) return "var(--chakra-colors-green-fg)";
    if (isDiscarded) return "var(--chakra-colors-fg-muted)";
    return "var(--chakra-colors-purple-fg)";
  })();

  const triggerOpen = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    if (openHref) {
      window.location.href = openHref;
    }
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      background="bg.subtle"
      opacity={isDiscarded ? 0.65 : 1}
      cursor={hasOpen ? "pointer" : "default"}
      // When the card behaves as a button (an applied proposal that opens
      // something on click) it needs button semantics so keyboard / screen-
      // reader users can activate it. Without this, only mouse users could
      // reach the affordance — the inner Open button is the keyboard
      // fallback but the whole-card click target is invisible to a11y.
      {...(hasOpen
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": `${openLabel}: ${proposal.summary}`,
            onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              const target = e.target as HTMLElement;
              if (target.closest("a, button")) return;
              e.preventDefault();
              triggerOpen();
            },
          }
        : {})}
      onClick={(e) => {
        if (!hasOpen) return;
        const target = e.target as HTMLElement;
        if (target.closest("a, button")) return;
        triggerOpen();
      }}
      transition="border-color 150ms ease, box-shadow 150ms ease"
      _hover={
        hasOpen ? { borderColor: "green.fg", boxShadow: "sm" } : undefined
      }
    >
      <HStack
        gap={1.5}
        marginBottom={2}
        textStyle="2xs"
        fontWeight="600"
        letterSpacing="0.08em"
        textTransform="uppercase"
        color={overlineColor}
      >
        {isApplied && !destructive ? (
          <Check size={11} />
        ) : (
          <GradientSparkle size={11} />
        )}
        <Text>{overlineLabel}</Text>
      </HStack>
      <Text textStyle="sm" fontWeight="600" color="fg" marginBottom={0.5}>
        {proposal.summary}
      </Text>
      {proposal.rationale && (
        <Text
          textStyle="xs"
          color="fg.muted"
          lineHeight="1.45"
          marginBottom={3}
        >
          {proposal.rationale}
        </Text>
      )}
      {!isApplied && !isDiscarded && (
        <HStack gap={1.5} paddingTop={proposal.rationale ? 0 : 2.5}>
          <chakra.button
            type="button"
            flex={1}
            paddingX={3}
            paddingY={2}
            borderRadius="md"
            borderWidth={0}
            background={
              destructive ? "var(--chakra-colors-red-solid)" : "transparent"
            }
            color="white"
            fontSize="12.5px"
            fontWeight={500}
            cursor={isApplying ? "default" : "pointer"}
            opacity={isApplying ? 0.7 : 1}
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap={1.5}
            boxShadow={destructive ? undefined : AI_SHADOW}
            onClick={onApply}
            disabled={isApplying}
            position="relative"
            overflow="hidden"
          >
            {!destructive && (
              <MeshGradientLayer borderRadius="md" active={isApplying} />
            )}
            <Box
              position="relative"
              zIndex={1}
              display="flex"
              alignItems="center"
              gap={1.5}
            >
              <Check size={12} />
              {isApplying
                ? destructive
                  ? "Deleting…"
                  : "Applying…"
                : destructive
                  ? "Delete"
                  : "Apply"}
            </Box>
          </chakra.button>
          <Button
            size="xs"
            variant="outline"
            onClick={onDiscard}
            disabled={isApplying}
          >
            {destructive ? "Cancel" : "Discard"}
          </Button>
        </HStack>
      )}
      {isApplied && hasOpen && (
        <HStack paddingTop={2.5}>
          {onOpen ? (
            <Button
              size="xs"
              variant="outline"
              colorPalette="green"
              onClick={triggerOpen}
            >
              {openLabel}
              <ArrowRight size={12} />
            </Button>
          ) : openHref ? (
            <Button size="xs" variant="outline" colorPalette="green" asChild>
              <a href={openHref}>
                {openLabel}
                <ArrowRight size={12} />
              </a>
            </Button>
          ) : null}
        </HStack>
      )}
    </Box>
  );
}

function extractProposals(
  message: UIMessage,
): Array<{ id: string; proposal: LangyProposal }> {
  const result: Array<{ id: string; proposal: LangyProposal }> = [];
  for (const part of message.parts) {
    if (!part.type?.startsWith("tool-")) continue;
    const output = (part as { output?: unknown }).output;
    if (!isLangyProposal(output)) continue;
    const id =
      (part as { toolCallId?: string }).toolCallId ??
      `${message.id}:${result.length}`;
    result.push({ id, proposal: output });
  }
  return result;
}

function isLangyProposal(value: unknown): value is LangyProposal {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.langyProposal === true &&
    typeof v.kind === "string" &&
    typeof v.summary === "string"
  );
}
