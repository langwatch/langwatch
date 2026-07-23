import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { GitPullRequest, Sparkles } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Chip } from "~/features/traces-v2/components/TraceDrawer/Chip";
import { QuietHeadline } from "./QuietHeadline";
import { useRouter } from "~/utils/compat/next-router";
import { LangyPanelSurface } from "~/features/asaplangy";
import type {
  BriefingData,
  BriefingReceipt,
  BriefingSeverity,
  ScenarioBar,
} from "../types";

/**
 * Langy's briefing — the first thing the returning user's eye lands on.
 *
 * The logged-in home is Langy's read on the project, not an ad for Langy. This
 * card leads with what changed since the reader was last here: a plain-language
 * headline, then the run behind it — plan chips, the scenarios that passed or
 * regressed, and the drafted fix — each a link straight to the traces / runs
 * that prove it. A stat you can click is a starting point; one you can't is a
 * report.
 *
 * It wears Langy's own skin (`langy-root`): the warm paper (light) / ink (dark)
 * palette the marketing site uses, a serif display voice, and one amber accent
 * spent only on Langy, status, and the primary action. That is the brand
 * carried across the login line, where the app used to reset to a template.
 *
 * Every section is optional: the card renders only what the project actually
 * has, so a project with no scenario run shows a shorter read, never a fake one.
 */

/** The serif display voice, self-hosted with the panel's fallbacks. */
const SERIF =
  'var(--langy-font-serif, "Sentient", "Charter", "Source Serif Pro", Georgia, serif)';

const BAR_FILL: Record<ScenarioBar["status"], string> = {
  pass: "green.solid",
  regression: "red.solid",
  fail: "red.solid",
};
const STAT_COLOR: Record<ScenarioBar["status"], string> = {
  pass: "green.fg",
  regression: "red.fg",
  fail: "red.fg",
};

const RECEIPT_DOT: Record<BriefingSeverity, string> = {
  error: "red.solid",
  attention: "#c98a2f",
  steady: "green.solid",
};
const METRIC_COLOR: Record<"down" | "up" | "ok", string> = {
  down: "red.fg",
  up: "#c98a2f",
  ok: "green.fg",
};

export function LangyBriefing({
  data,
  onAsk,
  onInvestigateReceipt,
  onAskSubmit,
  onFeedback,
  status,
}: {
  data: BriefingData;
  /** Opens Langy with the composer focused (the ⌘I entry point). */
  onAsk?: () => void;
  /**
   * Hands the row's exact evidence to Langy AND asks the question: attach the
   * signal's Trace Explorer query as context, open the panel, auto-send an
   * investigation prompt (the receipt's own askPrompt when it has one).
   */
  onInvestigateReceipt?: (receipt: BriefingReceipt) => void;
  /** The faux composer's Enter: open Langy with `question` already sent. */
  onAskSubmit?: (question: string) => void;
  /** Opens Langy with a feedback draft — what signal is the reader missing? */
  onFeedback?: () => void;
  /**
   * The project's numbers, folded INTO the sheet: rendered under a hairline
   * rule between the read and the ask row, so the briefing and the status are
   * one surface instead of two tinted cards with a seam between them.
   */
  status?: ReactNode;
}) {
  return (
    <LangyPanelSurface
      accent
      fill
      borderRadius="14px"
      padding={{ base: 4, md: 4 }}
    >
      <VStack align="stretch" gap={3} flex={1} minHeight={0}>
        <HStack justify="space-between" align="center" gap={3} wrap="wrap">
          {/* The sheet is LANGWATCH's read of the project — Langy is the AI you
              hand a signal to, not the byline. So the eyebrow names the
              content, not the assistant. */}
          <Text
            fontFamily="mono"
            fontSize="11px"
            fontWeight="500"
            letterSpacing="0.04em"
            textTransform="uppercase"
            color="orange.fg"
          >
            Agentic signals · {data.since}
          </Text>
          {data.loop ? (
            <Text fontFamily="mono" fontSize="11.5px" color="fg.muted">
              {data.loop}
            </Text>
          ) : null}
        </HStack>

        {data.quiet ? (
          // Nothing to read yet: the typed invitation takes the headline slot.
          <QuietHeadline />
        ) : (
          <Text
            fontFamily={SERIF}
            fontWeight="400"
            fontSize={{ base: "16px", md: "18px" }}
            lineHeight="1.3"
            letterSpacing="-0.01em"
            color="fg"
          >
            {data.headline}
          </Text>
        )}

        {data.receipts && data.receipts.length > 0 ? (
          <VStack align="stretch" gap={2}>
            {data.receiptsLabel ? (
              <HStack justify="space-between" align="center" gap={3}>
                <Text
                  fontFamily="mono"
                  fontSize="10px"
                  fontWeight="500"
                  letterSpacing="0.03em"
                  textTransform="uppercase"
                  color="fg.muted"
                >
                  {data.receiptsLabel}
                </Text>
                {onFeedback ? (
                  // The ask that shapes the roadmap: which signals do people
                  // actually need? Opens Langy with a feedback draft.
                  <chakra.button
                    type="button"
                    onClick={onFeedback}
                    fontFamily="mono"
                    fontSize="10.5px"
                    color="fg.subtle"
                    cursor="pointer"
                    transition="color 130ms ease"
                    _hover={{ color: "fg.muted" }}
                  >
                    Missing a signal? Tell us
                  </chakra.button>
                ) : null}
              </HStack>
            ) : null}
            <VStack
              align="stretch"
              gap="1px"
              background="border.muted"
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="10px"
              overflow="hidden"
            >
              {data.receipts.map((receipt) => (
                <ReceiptRow
                  key={receipt.id}
                  receipt={receipt}
                  onInvestigate={onInvestigateReceipt}
                />
              ))}
            </VStack>
          </VStack>
        ) : null}

        {data.pills && data.pills.length > 0 ? (
          <HStack gap={2} wrap="wrap">
            {data.pills.map((pill) => (
              <Chip key={pill.label} value={pill.label} maxValueWidth="none" />
            ))}
          </HStack>
        ) : null}

        {data.bars && data.bars.length > 0 ? (
          <VStack align="stretch" gap={2}>
            {data.scenariosLabel ? (
              <Text
                fontFamily="mono"
                fontSize="10px"
                fontWeight="500"
                letterSpacing="0.03em"
                textTransform="uppercase"
                color="fg.muted"
              >
                {data.scenariosLabel}
              </Text>
            ) : null}
            {data.bars.map((bar) => (
              <ScenarioRow key={bar.id} bar={bar} />
            ))}
            {data.barsMore ? (
              <Text fontFamily="mono" fontSize="12px" color="fg.muted">
                {data.barsMore}
              </Text>
            ) : null}
          </VStack>
        ) : null}

        {data.judge ? (
          <HStack
            justify="space-between"
            align="center"
            gap={3}
            wrap="wrap"
            paddingX={3}
            paddingY={2}
            borderWidth="1px"
            borderColor="border.emphasized"
            borderRadius="10px"
            background="bg.panel"
          >
            <Text fontFamily="mono" fontSize="12px" color="fg.muted">
              JudgeAgent ·{" "}
              <Text as="span" color="green.fg">
                {data.judge.pass} pass
              </Text>
              {data.judge.regressions > 0 ? (
                <>
                  {" · "}
                  <Text as="span" color="red.fg">
                    {data.judge.regressions} failing
                  </Text>
                </>
              ) : null}
            </Text>
            {data.judge.note ? (
              <Text
                fontFamily="mono"
                fontSize="10px"
                fontWeight="500"
                letterSpacing="0.03em"
                textTransform="uppercase"
                color="fg.muted"
              >
                {data.judge.note}
              </Text>
            ) : null}
          </HStack>
        ) : null}

        {data.draftedPr ? (
          <HStack
            gap={3}
            align="center"
            padding={3}
            borderWidth="1px"
            borderColor="border.emphasized"
            borderRadius="10px"
            background="bg.panel"
          >
            <Box color="orange.fg" flexShrink={0}>
              <GitPullRequest size={15} />
            </Box>
            <VStack align="start" gap={0.5} flex={1} minWidth={0}>
              <Text fontFamily="mono" fontSize="13px" color="fg" lineClamp={1}>
                {data.draftedPr.title}
              </Text>
              <Text fontFamily="mono" fontSize="12px" color="fg.muted">
                {data.draftedPr.meta}
                {data.draftedPr.added != null ? (
                  <>
                    {" · "}
                    <Text as="span" color="green.fg">
                      +{data.draftedPr.added}
                    </Text>{" "}
                    <Text as="span" color="red.fg">
                      −{data.draftedPr.removed ?? 0}
                    </Text>
                  </>
                ) : null}
              </Text>
            </VStack>
            <BriefingLink label="Review" href={data.draftedPr.href} solid />
          </HStack>
        ) : null}

        {status ? (
          <VStack align="stretch" gap={3} paddingTop={1}>
            <Box borderTopWidth="1px" borderColor="border.muted" />
            {status}
          </VStack>
        ) : null}

        {/* The ask row exists to hand the sheet to Langy, so its controls
            render only when their handlers do — without Langy the sheet
            closes on the status figures (or the session link) instead of a
            row of buttons that would open a panel that never mounts. */}
        {onAsk || (onAskSubmit && data.suggestions?.length) ||
        data.sessionHref ? (
          <HStack
            justify="space-between"
            align="center"
            gap={3}
            wrap="wrap"
            marginTop="auto"
            paddingTop={2}
          >
            <HStack gap={2} wrap="wrap" align="center" minWidth={0}>
              {onAsk ? (
                <chakra.button
                  type="button"
                  onClick={onAsk}
                  display="inline-flex"
                  alignItems="center"
                  gap={2}
                  fontFamily="mono"
                  fontSize="12.5px"
                  color="fg.muted"
                  cursor="pointer"
                  _hover={{ color: "fg" }}
                  transition="color 130ms ease"
                >
                  Investigate
                  <Box
                    as="kbd"
                    borderWidth="1px"
                    borderColor="border.emphasized"
                    borderRadius="6px"
                    paddingX="6px"
                    paddingY="1px"
                    fontSize="10.5px"
                    color="fg.subtle"
                  >
                    ⌘I
                  </Box>
                </chakra.button>
              ) : null}
              {/* One-click asks built from the project's own data — a chip is a
                  question already answered by the time the panel opens. */}
              {onAskSubmit
                ? data.suggestions?.map((question) => (
                    <chakra.button
                      key={question}
                      type="button"
                      onClick={() => onAskSubmit(question)}
                      fontFamily="mono"
                      fontSize="11.5px"
                      color="fg.muted"
                      borderWidth="1px"
                      borderColor="border.muted"
                      borderRadius="full"
                      paddingX={2.5}
                      paddingY="3px"
                      cursor="pointer"
                      whiteSpace="nowrap"
                      transition="color 130ms ease, border-color 130ms ease"
                      _hover={{
                        color: "orange.fg",
                        borderColor: "orange.emphasized",
                      }}
                    >
                      {question}
                    </chakra.button>
                  ))
                : null}
            </HStack>
            {data.sessionHref ? (
              <BriefingLink label="Open session" href={data.sessionHref} />
            ) : null}
          </HStack>
        ) : null}
      </VStack>
    </LangyPanelSurface>
  );
}

/**
 * One attention-inbox row, with exactly two NAMED ways out:
 *
 *   1. VIEW the signal ("View errors →") — the row IS this action: a
 *      full-bleed anchor sits under the text so clicking anywhere opens the
 *      exact Trace Explorer search behind the claim (⌘/middle-click still
 *      opens a new tab — real link). The label just says so out loud.
 *   2. INVESTIGATE in Langy — the one control floating above that anchor:
 *      hands the row's evidence to Langy and asks in one click, so the reader
 *      lands in a conversation that is already answering.
 */
function ReceiptRow({
  receipt,
  onInvestigate,
}: {
  receipt: BriefingReceipt;
  onInvestigate?: (receipt: BriefingReceipt) => void;
}) {
  const router = useRouter();
  const href = receipt.link?.href;
  const external = href ? /^https?:\/\//.test(href) : false;
  const subjectName = receipt.subject ?? "this signal";

  // Internal routes navigate through the router (SPA, no reload); an external
  // href (a real URL) is left to the browser so a new tab still works.
  const openTraces = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!href || external) return;
    event.preventDefault();
    void router.push(href);
  };

  return (
    <Box
      position="relative"
      background="bg.surface"
      transition="background 130ms ease"
      _hover={href ? { background: "bg.muted" } : undefined}
      css={{
        "&:hover .receipt-chevron": { opacity: 1, transform: "translateX(0)" },
      }}
    >
      {href ? (
        <chakra.a
          href={href}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          onClick={openTraces}
          aria-label={`Open traces for ${subjectName}`}
          position="absolute"
          inset={0}
          zIndex={0}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: "orange.focusRing",
            outlineOffset: "-2px",
          }}
        />
      ) : null}
      <HStack
        position="relative"
        zIndex={1}
        // The text/dot/badge let the click fall through to the anchor beneath;
        // only the paperclip re-enables pointer events (it's a real button).
        pointerEvents={href ? "none" : undefined}
        gap={2.5}
        // Centre the row on a common line: the dot, the text, and the
        // metric/clip cluster all share one vertical centre (the 26px clip sets
        // the row height), so a single-line receipt reads as one aligned row
        // rather than text floating above the badge.
        align="center"
        paddingX={3}
        paddingY={2.5}
      >
        <Box
          width="7px"
          height="7px"
          borderRadius="full"
          flexShrink={0}
          // Sits a hair above the text's optical centre so it reads as the
          // bullet starting the line, not a full stop mid-height.
          alignSelf="center"
          marginTop="-1px"
          background={RECEIPT_DOT[receipt.severity]}
        />
        <Text
          fontSize="13px"
          color="fg.muted"
          flex={1}
          minWidth={0}
          lineHeight="1.5"
        >
          {receipt.subject ? (
            <Text
              as="span"
              fontFamily="mono"
              fontSize="12.5px"
              fontWeight="600"
              color="fg"
            >
              {receipt.subject}{" "}
            </Text>
          ) : null}
          {receipt.detail}
        </Text>
        <HStack gap={2.5} flexShrink={0} align="center">
          {receipt.metric ? (
            <Text
              fontFamily="mono"
              fontSize="12px"
              whiteSpace="nowrap"
              color={METRIC_COLOR[receipt.metric.tone]}
              fontVariantNumeric="tabular-nums"
            >
              {receipt.metric.text}
            </Text>
          ) : null}
          {href ? (
            // The row's own action, named on hover only — at rest the cluster
            // shows one status and one button, not a menu. Fall-through
            // (pointer-events stay off): clicks land on the full-row anchor
            // beneath, which already carries the aria-label.
            <Text
              className="receipt-chevron"
              as="span"
              color="fg.muted"
              fontFamily="mono"
              fontSize="11px"
              whiteSpace="nowrap"
              textDecoration="underline"
              textUnderlineOffset="3px"
              textDecorationColor="border.emphasized"
              opacity={0}
              transform="translateX(-3px)"
              transition="opacity 130ms ease, transform 130ms ease"
              aria-hidden
            >
              {receipt.link?.label ?? "Open traces"}
            </Text>
          ) : null}
          {receipt.context && onInvestigate ? (
            <Box pointerEvents="auto">
              {/* Boxed at rest so it reads as a BUTTON, clearly separate from
                  the row's own open-traces label to its left. */}
              <chakra.button
                type="button"
                aria-label={`Investigate ${subjectName} in Langy`}
                display="inline-flex"
                alignItems="center"
                gap={1}
                fontFamily="mono"
                fontSize="11px"
                color="orange.fg"
                borderWidth="1px"
                borderColor="orange.emphasized"
                borderRadius="7px"
                paddingX={2}
                paddingY="3px"
                cursor="pointer"
                transition="border-color 130ms ease, background 130ms ease"
                _hover={{
                  borderColor: "orange.fg",
                  background: "bg.panel",
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onInvestigate(receipt);
                }}
              >
                <Sparkles size={11} />
                Investigate
              </chakra.button>
            </Box>
          ) : null}
        </HStack>
      </HStack>
    </Box>
  );
}

function ScenarioRow({ bar }: { bar: ScenarioBar }) {
  return (
    <HStack
      gap={{ base: 2.5, md: 3.5 }}
      align="center"
      display="grid"
      gridTemplateColumns={{ base: "1fr", md: "minmax(0, 200px) 1fr 92px" }}
    >
      <Text
        fontFamily="mono"
        fontSize="12px"
        color="fg.muted"
        lineClamp={1}
        minWidth={0}
      >
        {bar.label}
      </Text>
      <Box
        height="8px"
        borderRadius="5px"
        background="langy.barTrack"
        overflow="hidden"
      >
        <Box
          height="full"
          width={`${Math.max(4, Math.min(100, bar.fillPct))}%`}
          borderRadius="6px"
          background={BAR_FILL[bar.status]}
        />
      </Box>
      <Text
        fontFamily="mono"
        fontSize="12px"
        textAlign={{ base: "left", md: "right" }}
        color={STAT_COLOR[bar.status]}
        fontVariantNumeric="tabular-nums"
      >
        {bar.statLabel}
      </Text>
    </HStack>
  );
}

/**
 * A briefing link. Internal app routes go through the router (SPA navigation,
 * no full reload); external URLs (a drafted PR on GitHub) open as real links.
 */
function BriefingLink({
  label,
  href,
  solid = false,
}: {
  label: string;
  href: string;
  solid?: boolean;
}) {
  const router = useRouter();
  const external = /^https?:\/\//.test(href);

  // Internal routes navigate through the router (SPA, no full reload); external
  // URLs (a drafted PR on GitHub) open as real links in a new tab.
  const linkProps = external
    ? { href, target: "_blank", rel: "noreferrer" }
    : {
        href,
        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          void router.push(href);
        },
      };

  if (solid) {
    return (
      <chakra.a
        {...linkProps}
        flexShrink={0}
        fontFamily="mono"
        fontSize="12.5px"
        whiteSpace="nowrap"
        cursor="pointer"
        color="fg"
        borderWidth="1px"
        borderColor="border.emphasized"
        borderRadius="9px"
        paddingX={3.5}
        paddingY="7px"
        background="bg.emphasized"
        transition="border-color 130ms ease, color 130ms ease"
        _hover={{ borderColor: "orange.emphasized", color: "orange.fg" }}
      >
        {label} →
      </chakra.a>
    );
  }
  return (
    <chakra.a
      {...linkProps}
      flexShrink={0}
      fontFamily="mono"
      fontSize="12.5px"
      whiteSpace="nowrap"
      cursor="pointer"
      color="orange.fg"
      borderBottomWidth="1px"
      borderColor="transparent"
      paddingBottom="1px"
      transition="border-color 130ms ease"
      _hover={{ borderColor: "orange.fg" }}
    >
      {label} →
    </chakra.a>
  );
}
