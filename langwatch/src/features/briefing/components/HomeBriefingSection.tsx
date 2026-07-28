import { Box, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { LangyPanelSurface } from "~/features/asaplangy";
import { useShowLangy } from "~/features/langy/hooks/useShowLangy";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { HomeOverviewCard } from "./HomeOverviewCard";
import { LangyBriefing } from "./LangyBriefing";
import { useLangyBriefing } from "../hooks/useLangyBriefing";
import type { BriefingReceipt } from "../types";

/**
 * The briefing sheet that leads the home: Langy's read AND the project's
 * numbers on ONE Langy surface — headline, receipts, then the status grid
 * under a hairline rule, closed by the ask row. One sheet instead of a grid
 * of cards: the home used to sit a quick-links rail beside the briefing, but
 * it only repeated the sidebar (the page's own rule: home never repeats the
 * sidebar as cards) and left a mostly-empty card hanging next to a dense one.
 * Container-only: it fetches the real signals and hands them to the
 * presentational sheet.
 *
 * Progressive, shift-free load: the SAME structure renders whether data has
 * arrived or not, so content fills IN PLACE (skeleton → real) instead of
 * reshaping the sheet. `keepPreviousData` keeps cached figures on screen
 * through a refetch, which the overview marks with a subtle "refreshing" hint
 * rather than a skeleton swap.
 */
export function HomeBriefingSection() {
  const { data, statusCells, isLoading, isAnalyticsLoading, isRefreshing } =
    useLangyBriefing();
  const { project } = useOrganizationTeamProject();
  // The sheet renders wherever the signal-focused home is rolled out — with
  // or without Langy (spec: specs/home/signal-focused-home-rollout.feature).
  // Without Langy, every hand-to-Langy handler stays undefined so the sheet
  // offers only its own evidence links, never a panel that won't mount.
  const showLangy = useShowLangy();
  // Reading Langy and STARTING a turn are different grants. Everything below
  // that auto-sends a question needs `langy:create`; only the two that hand the
  // reader a composer they finish themselves are safe on `langy:view`. With
  // built-in roles the two always travel together, but the Langy permission
  // category's read level is exactly `langy:view`, so a custom role or key can
  // hold one without the other — and would otherwise meet a button that 403s.
  const canAsk = useCanAskLangy();
  const openPanel = useLangyStore((s) => s.openPanel);
  const askLangy = useLangyStore((s) => s.askLangy);
  const attachContext = useLangyStore((s) => s.attachContext);
  const setDraft = useLangyStore((s) => s.setDraft);

  // Feedback stays a DRAFT (never auto-sent): the reader finishes the
  // sentence themselves, and the conversation lands where the team reads.
  const handleSignalFeedback = () => {
    setDraft("Feedback on the anomalies feed: the signal I'm missing is ");
    openPanel();
  };

  // "Investigate" is one click to an answer, not a loaded composer: askLangy
  // opens the panel on a fresh conversation with the question queued to
  // auto-send, and the attach (AFTER the reset, which doesn't touch
  // attachedContext) pins the row's exact trace filter as the evidence the
  // answer cites. A receipt's own scoped askPrompt wins when it has one.
  const handleInvestigateReceipt = (receipt: BriefingReceipt) => {
    if (!receipt.context) return;
    const subject = receipt.subject ?? receipt.context.label;
    askLangy(
      receipt.askPrompt ??
        `Investigate the "${subject}" signal — what changed, what's the likely cause, and what should I look at first?`,
    );
    attachContext({
      type: "filter",
      id: receipt.context.id,
      label: receipt.context.label,
      meta: {
        query: receipt.context.query,
        severity: receipt.severity,
        ...(receipt.context.meta ?? {}),
      },
    });
  };

  // `data` is effectively always present once past first paint; the guard only
  // covers the brief window before the fast scenario roll-up settles.
  if (!isLoading && !data) return null;

  if (isLoading || !data) return <BriefingHeadlineSkeleton />;

  // A suggestion chip asks WITH the sheet's evidence: every anomaly's trace
  // filter rides along as context, so the answer can cite the signals the
  // question was prompted by.
  const handleAskSubmit = (question: string) => {
    askLangy(question);
    for (const receipt of data?.receipts ?? []) {
      if (!receipt.context) continue;
      attachContext({
        type: "filter",
        id: receipt.context.id,
        label: receipt.context.label,
        meta: {
          query: receipt.context.query,
          severity: receipt.severity,
          ...(receipt.context.meta ?? {}),
        },
      });
    }
  };

  return (
    <LangyBriefing
      data={data}
      onAsk={showLangy ? openPanel : undefined}
      onAskSubmit={canAsk ? handleAskSubmit : undefined}
      onFeedback={showLangy ? handleSignalFeedback : undefined}
      onInvestigateReceipt={canAsk ? handleInvestigateReceipt : undefined}
      status={
        <HomeOverviewCard
          bare
          cells={statusCells}
          rangeLabel="Last 30 days"
          isLoading={isAnalyticsLoading}
          refreshing={isRefreshing}
          dashboardsHref={project ? `/${project.slug}/analytics` : undefined}
        />
      }
    />
  );
}

/**
 * The briefing card's first-paint placeholder. It mirrors the real card's shape
 * — the live eyebrow, a two-line headline, a receipts block, and a footer pinned
 * to the bottom — so content fills IN PLACE (skeleton → real) instead of the card
 * changing shape or height as the read lands.
 */
function BriefingHeadlineSkeleton() {
  return (
    <LangyPanelSurface
      accent
      fill
      borderRadius="14px"
      padding={{ base: 4, md: 4 }}
    >
      <VStack align="stretch" gap={3} flex={1} minHeight={0}>
        {/* The eyebrow is real — the label never needs to load. */}
        <Text
          fontFamily="mono"
          fontSize="11px"
          fontWeight="500"
          letterSpacing="0.04em"
          textTransform="uppercase"
          color="orange.fg"
          opacity={0.7}
        >
          Agentic signals
        </Text>

        {/* Headline — two serif-height lines, matching the real read. */}
        <VStack align="stretch" gap={2}>
          <Skeleton height="18px" width={{ base: "92%", md: "72%" }} />
          <Skeleton height="18px" width={{ base: "68%", md: "44%" }} />
        </VStack>

        {/* Receipts block — the same hairline inset the real receipts sit in,
            with a couple of placeholder rows (dot · text · metric). */}
        <VStack
          align="stretch"
          gap="1px"
          background="border.muted"
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="10px"
          overflow="hidden"
        >
          {[0, 1].map((row) => (
            <HStack
              key={row}
              gap={2.5}
              align="center"
              paddingX={3}
              paddingY={2.5}
              background="bg.surface"
            >
              <Skeleton width="7px" height="7px" borderRadius="full" />
              <Skeleton
                height="12px"
                flex={1}
                width={row === 0 ? "70%" : "56%"}
              />
              <Skeleton height="12px" width="34px" />
            </HStack>
          ))}
        </VStack>

        {/* Status section — the hairline rule + label + a row of figures,
            mirroring the sheet's folded-in overview. */}
        <VStack align="stretch" gap={3} paddingTop={1}>
          <Box borderTopWidth="1px" borderColor="border.muted" />
          <Skeleton height="10px" width="164px" />
          <HStack gap={6}>
            {[0, 1, 2].map((cell) => (
              <VStack key={cell} align="start" gap={2.5}>
                <Skeleton height="11px" width="72px" />
                <Skeleton height="24px" width="88px" />
              </VStack>
            ))}
          </HStack>
        </VStack>

        {/* Footer, pinned to the bottom exactly like the real card's Ask row. */}
        <HStack marginTop="auto" justify="space-between" gap={3}>
          <Skeleton height="13px" width="96px" />
          <Skeleton height="13px" width="72px" />
        </HStack>
      </VStack>
    </LangyPanelSurface>
  );
}
