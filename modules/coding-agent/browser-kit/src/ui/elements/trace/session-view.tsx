import { Box, Grid, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type { TranscriptEntry } from "@langwatch/coding-agent-contract";
import { formatCost } from "@langwatch/design-system/display-formatters";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { ReactNode } from "react";
import { useMemo } from "react";

import {
  contextHealthBand,
  contextWindowCeiling,
  type ContextHealthTone,
} from "../../../model/trace/context-health.ts";
import type { CodingAgentSessionDisplay } from "../../../model/trace/session-display.ts";
import {
  deriveSessionSignals,
  formatCompact,
  formatShortDuration,
  type SessionSignal,
} from "../../../model/trace/session-signals.ts";
import { deriveTokenTimeline, findCacheRebuilds } from "../../../model/trace/token-timeline.ts";
import { TokenTimelineChart } from "./token-timeline-chart.tsx";

/**
 * Session overview: folded metrics (ADR-056) answering health and cost, not
 * moment-by-moment replay. Pre-folded row enables single-read instead of re-walking 800 spans.
 */

interface SessionViewProps {
  session: CodingAgentSessionDisplay;
  /**
   * Per-call token timeline. The fold above sums cache reused/rebuilt but not
   * where; optional so its absence doesn't fail the tab.
   */
  entries?: TranscriptEntry[];
}

export function SessionView({ session, entries }: SessionViewProps) {
  const signals = useMemo(() => deriveSessionSignals(session), [session]);
  const tokenTimeline = useMemo(() => (entries ? deriveTokenTimeline(entries) : []), [entries]);
  const cacheRebuilds = useMemo(() => (entries ? findCacheRebuilds(entries) : []), [entries]);

  return (
    <Box height="full" overflowY="auto">
      <VStack align="stretch" gap={6} padding={5} paddingBottom={10}>
        <Headline session={session} />

        {/*
          Signals lead. The stat grid below can tell you the cache was rebuilt
          318k tokens' worth, but only this can tell you that's four rebuilds and
          it cost you money. Findings before figures.
        */}
        {signals.length > 0 && <Signals signals={signals} />}

        {/*
          Cache health, then what it reached for — promoted above the
          replay/timing sections below them. Someone opening this tab wants
          "was this session healthy and what did it use" before "what order
          did it do things in".
        */}
        <CacheHealth session={session} />

        <Extensions session={session} />

        <ContextNoise session={session} />

        {tokenTimeline.length > 0 && (
          <Section title="Where the tokens went">
            <TokenTimelineChart points={tokenTimeline} rebuilds={cacheRebuilds} />
          </Section>
        )}

        <Section title="What it did">
          <Steps steps={session.steps} />
        </Section>

        <Section title="Where the time went">
          <TimeBreakdown session={session} />
        </Section>

        {Object.keys(session.toolCounts).length > 0 && (
          <Section title="Tools">
            <ToolTable counts={session.toolCounts} durations={session.toolDurationMs} />
          </Section>
        )}

        <Outcome session={session} />
      </VStack>
    </Box>
  );
}

/**
 * Dedup sets cap at 50 (MAX_SET in coding-agent-session.derivation.ts); a
 * figure reading exactly 50 is a floor, not a count, so it renders "50+".
 */
const FOLD_SET_CAP = 50;

function boundedCount(n: number): string {
  return n >= FOLD_SET_CAP ? `${FOLD_SET_CAP}+` : String(n);
}

function Headline({ session }: { session: CodingAgentSessionDisplay }) {
  // No agent/version/model chips: the drawer header already shows Service and
  // Models, and the agent version is in the Terminal tab's banner. Only the
  // multi-trace note earns a spot, since a compaction, `/clear`, or a session
  // outliving its limit can merge more than one trace into this view.
  return (
    <VStack align="stretch" gap={3}>
      {session.traceIds.length > 1 && (
        <HStack gap={2} flexWrap="wrap">
          <MetaChip>{`spans ${boundedCount(session.traceIds.length)} traces`}</MetaChip>
        </HStack>
      )}

      <Grid templateColumns="repeat(auto-fit, minmax(120px, 1fr))" gap={3} alignItems="stretch">
        <Stat label="Cost" value={formatCost(session.costUsd)} emphasis />
        <Stat label="Model calls" value={String(session.modelCalls)} />
        <Stat label="Tools run" value={String(session.toolCalls)} />
        {session.subAgents > 0 && (
          <Stat label="Sub-agents" value={boundedCount(session.subAgents)} />
        )}
        <Stat label="Files touched" value={boundedCount(session.filesTouched.length)} />
      </Grid>
    </VStack>
  );
}

function signalToneColors(tone: SessionSignal["tone"]): {
  border: string;
  bg: string;
  bar: string;
} {
  if (tone === "danger") return { border: "red.solid/30", bg: "red.solid/8", bar: "red.solid" };
  if (tone === "warning") {
    return { border: "yellow.solid/30", bg: "yellow.solid/8", bar: "yellow.solid" };
  }
  return { border: "border", bg: "bg.subtle", bar: "border.emphasized" };
}

function Signals({ signals }: { signals: SessionSignal[] }) {
  return (
    <VStack align="stretch" gap={2}>
      {signals.map((signal) => (
        <HStack
          key={signal.id}
          align="start"
          gap={3}
          padding={3}
          borderWidth="1px"
          borderRadius="md"
          borderColor={signalToneColors(signal.tone).border}
          bg={signalToneColors(signal.tone).bg}
        >
          <Box
            width="3px"
            alignSelf="stretch"
            borderRadius="full"
            bg={signalToneColors(signal.tone).bar}
            flexShrink={0}
          />
          <VStack align="start" gap={0.5}>
            <Text textStyle="sm" fontWeight="semibold" color="fg">
              {signal.title}
            </Text>
            <Text textStyle="xs" color="fg.muted">
              {signal.detail}
            </Text>
          </VStack>
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * Batched order of what happened. Counts alone lose the story; the sequence
 * shows it read the files, ran the tests, fixed one, ran them again, with a
 * failed step marked where it failed rather than hoisted out of order.
 */
function Steps({ steps }: { steps: [string, number, boolean][] }) {
  if (steps.length === 0) {
    return (
      <Text textStyle="xs" color="fg.muted">
        No tools were run: the agent answered from what it already knew.
      </Text>
    );
  }

  return (
    <HStack gap={1} flexWrap="wrap" alignItems="center">
      {steps.map(([name, count, failed], index) => (
        <HStack key={`${name}-${index}`} gap={1} alignItems="center">
          {index > 0 && (
            <Text textStyle="xs" color="fg.subtle" aria-hidden>
              ›
            </Text>
          )}
          <HStack
            gap={1}
            paddingX={2}
            paddingY={0.5}
            borderRadius="sm"
            borderWidth="1px"
            borderColor={failed ? "red.solid/30" : "border"}
            bg={failed ? "red.solid/8" : "bg.subtle"}
          >
            <Text textStyle="xs" fontFamily="mono" color={failed ? "red.fg" : "fg.muted"}>
              {name}
            </Text>
            {count > 1 && (
              <Text textStyle="xs" color="fg.subtle">
                ×{count}
              </Text>
            )}
          </HStack>
        </HStack>
      ))}
    </HStack>
  );
}

/**
 * Model time, tool time, and the one duration nothing else surfaces: how long a
 * human sat there waiting to approve something. That last bar is pure friction —
 * the agent was idle and so was the person.
 */
function TimeBreakdown({ session }: { session: CodingAgentSessionDisplay }) {
  const bars = [
    { label: "Thinking", ms: session.modelCallMs, color: "blue.solid" },
    { label: "Running tools", ms: session.toolMs, color: "green.solid" },
    {
      label: "Waiting for you",
      ms: session.blockedOnUserMs,
      color: "yellow.solid",
    },
    { label: "Retrying", ms: session.retryMs, color: "red.solid" },
  ].filter((bar) => bar.ms > 0);

  const total = bars.reduce((sum, bar) => sum + bar.ms, 0);

  if (total === 0) {
    return (
      <Text textStyle="xs" color="fg.muted">
        No timing was reported for this run.
      </Text>
    );
  }

  const meanTtft = session.ttftSamples > 0 ? session.ttftMsTotal / session.ttftSamples : null;

  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={0.5} height="8px" width="full">
        {bars.map((bar) => (
          <Box
            key={bar.label}
            flex={bar.ms / total}
            bg={bar.color}
            borderRadius="full"
            minWidth="2px"
          />
        ))}
      </HStack>
      <HStack gap={4} flexWrap="wrap">
        {bars.map((bar) => (
          <HStack key={bar.label} gap={1.5}>
            <Box width="8px" height="8px" borderRadius="full" bg={bar.color} />
            <Text textStyle="xs" color="fg.muted">
              {bar.label}
            </Text>
            <Text textStyle="xs" color="fg" fontWeight="medium">
              {formatShortDuration(bar.ms)}
            </Text>
          </HStack>
        ))}
      </HStack>
      {meanTtft !== null && (
        <Text textStyle="xs" color="fg.subtle">
          Typically {formatShortDuration(meanTtft)} before the model started replying.
        </Text>
      )}
    </VStack>
  );
}

function ToolTable({
  counts,
  durations,
}: {
  counts: Record<string, number>;
  durations: Record<string, number>;
}) {
  const rows = Object.entries(counts).toSorted((a, b) => b[1] - a[1]);
  const busiest = rows[0]?.[1] ?? 1;

  return (
    <VStack align="stretch" gap={1}>
      {rows.map(([tool, count]) => (
        <HStack key={tool} gap={3}>
          <Text textStyle="xs" fontFamily="mono" color="fg" width="140px" flexShrink={0} truncate>
            {tool}
          </Text>
          {/* The bar is the point: it says at a glance which tool the session
              actually lived in, which a column of numbers does not. */}
          <Box flex={1} height="6px" bg="bg.muted" borderRadius="full">
            <Box
              width={`${(count / busiest) * 100}%`}
              height="full"
              bg="blue.solid/50"
              borderRadius="full"
            />
          </Box>
          <Text textStyle="xs" color="fg" width="40px" textAlign="right">
            {count}
          </Text>
          <Text textStyle="xs" color="fg.subtle" width="60px" textAlign="right" flexShrink={0}>
            {durations[tool] ? formatShortDuration(durations[tool]) : "—"}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * Promoted out of the headline grid: peak context is banded against the
 * reliability curve in contextHealth.ts, and cache misses plus the worst
 * rebuild turn a raw "context rebuilt" number into a concrete story.
 */
function cacheRebuildTone(cacheRebuildCount: number): ContextHealthTone {
  if (cacheRebuildCount === 0) return "success";
  if (cacheRebuildCount <= 2) return "warning";
  return "danger";
}

function CacheHealth({ session }: { session: CodingAgentSessionDisplay }) {
  const ceiling = contextWindowCeiling(session.models);
  const ratio = session.peakContextTokens / ceiling;
  const band = contextHealthBand(ratio);
  const rebuildTone = cacheRebuildTone(session.cacheRebuildCount);

  return (
    <Section title="Cache health">
      <VStack align="stretch" gap={2}>
        <Grid templateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap={3}>
          <Stat
            label="Peak context"
            value={formatCompact(session.peakContextTokens)}
            hint={`${Math.round(ratio * 100)}% of the ${formatCompact(ceiling)}-token window: ${band.label.toLowerCase()}, per the current reliability guidance for long-context sessions.`}
            tone={session.peakContextTokens > 0 ? band.tone : undefined}
          />
          <Stat
            label="Cache misses"
            value={String(session.cacheRebuildCount)}
            hint="Model calls that re-created most of the context instead of reading it from cache. A cache WRITE costs more per token than a read, so this is the session paying twice for the same tokens."
            tone={rebuildTone}
          />
          <Stat
            label="Context reused"
            value={formatCompact(session.cacheReadTokens)}
            hint="Tokens served from the cache across the whole session. These bill at a fraction of fresh input: the more the better."
          />
          <Stat
            label="Context rebuilt"
            value={formatCompact(session.cacheCreationTokens)}
            hint="Tokens spent writing the cache again, summed across the whole session."
          />
        </Grid>
        {session.largestCacheRebuildTokens > 0 && (
          <Text textStyle="xs" color="fg.muted">
            Biggest single rebuild: {formatCompact(session.largestCacheRebuildTokens)} tokens
            re-sent instead of being reused from cache.
          </Text>
        )}
      </VStack>
    </Section>
  );
}

/**
 * Compaction count is Claude Code's own signal of context noise — its
 * judgement call, not an invented ratio. Renders nothing when zero.
 */
function ContextNoise({ session }: { session: CodingAgentSessionDisplay }) {
  if (session.compactions === 0) return null;

  return (
    <Section title="Context noise">
      <VStack align="stretch" gap={1}>
        <Text textStyle="sm" color="fg">
          Compacted {session.compactions}× — {formatCompact(session.compactionTokensBefore)} →{" "}
          {formatCompact(session.compactionTokensAfter)} tokens.
        </Text>
        <Text textStyle="xs" color="fg.muted">
          Older detail gets summarised away once the context outgrows the window. Anything the agent
          forgot after this point, it forgot here.
        </Text>
      </VStack>
    </Section>
  );
}

/**
 * What the session reached for beyond its built-in tools — an MCP server used
 * once, a skill that fired, a sub-agent type nobody knew was running.
 */
function Extensions({ session }: { session: CodingAgentSessionDisplay }) {
  // Skills lead — "which skills did you use" is the first thing anyone asks
  // about a session, ahead of which MCP servers or sub-agents it reached for.
  const groups = [
    { label: "Skills", values: session.skills },
    { label: "Sub-agents", values: session.subAgentTypes },
    { label: "Commands", values: session.slashCommands },
    { label: "MCP servers", values: session.mcpServers },
    { label: "MCP tools", values: session.mcpTools },
  ].filter((group) => group.values.length > 0);

  if (groups.length === 0) return null;

  return (
    <Section title="Reached for">
      <VStack align="stretch" gap={2}>
        {groups.map((group) => (
          <HStack key={group.label} align="start" gap={3}>
            <Text textStyle="xs" color="fg.muted" width="100px" flexShrink={0} paddingTop={1}>
              {group.label}
            </Text>
            <HStack gap={1} flexWrap="wrap">
              {group.values.map((value) => (
                <MetaChip key={value}>{value}</MetaChip>
              ))}
            </HStack>
          </HStack>
        ))}
      </VStack>
    </Section>
  );
}

/** What actually came out of the session — the only part anyone keeps. */
function Outcome({ session }: { session: CodingAgentSessionDisplay }) {
  const hasCode = session.linesAdded > 0 || session.linesRemoved > 0;
  const hasReview = session.editsAccepted > 0 || session.editsRejected > 0;

  if (!hasCode && !hasReview && !session.commits && !session.pullRequests) {
    return null;
  }

  return (
    <Section title="What came out of it">
      <HStack gap={5} flexWrap="wrap">
        {hasCode && (
          <HStack gap={2}>
            <Text textStyle="sm" color="green.fg" fontWeight="medium">
              +{session.linesAdded}
            </Text>
            <Text textStyle="sm" color="red.fg" fontWeight="medium">
              −{session.linesRemoved}
            </Text>
            <Text textStyle="xs" color="fg.muted">
              lines
              {session.languagesEdited.length > 0 && ` of ${session.languagesEdited.join(", ")}`}
            </Text>
          </HStack>
        )}
        {session.commits > 0 && <Stat label="Commits" value={String(session.commits)} compact />}
        {session.pullRequests > 0 && (
          <Stat label="Pull requests" value={String(session.pullRequests)} compact />
        )}
        {hasReview && (
          <Text textStyle="xs" color="fg.muted">
            You kept {session.editsAccepted} of {session.editsAccepted + session.editsRejected}{" "}
            suggested edits
          </Text>
        )}
      </HStack>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack align="stretch" gap={2.5}>
      <HStack gap={3} align="center">
        <Text
          textStyle="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
          flexShrink={0}
        >
          {title}
        </Text>
        <Separator flex={1} borderColor="border.muted" />
      </HStack>
      {children}
    </VStack>
  );
}

/**
 * Border / background / text colour for a toned Stat — one place, so Cache health and
 * Context noise read consistently with the existing warning-only stats.
 */
const STAT_TONE_COLORS: Record<ContextHealthTone, { border: string; bg: string; fg: string }> = {
  success: { border: "green.solid/30", bg: "green.solid/8", fg: "green.fg" },
  info: { border: "border", bg: "bg.subtle", fg: "fg" },
  warning: { border: "yellow.solid/30", bg: "yellow.solid/8", fg: "yellow.fg" },
  danger: { border: "red.solid/30", bg: "red.solid/8", fg: "red.fg" },
};

function Stat({
  label,
  value,
  hint,
  emphasis,
  compact,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  compact?: boolean;
  tone?: ContextHealthTone;
}) {
  const colors = tone ? STAT_TONE_COLORS[tone] : null;
  const body = (
    <VStack
      align="start"
      gap={0}
      padding={compact ? 0 : 3}
      borderWidth={compact ? 0 : "1px"}
      borderColor={colors?.border ?? "border"}
      borderRadius="md"
      bg={compact ? undefined : (colors?.bg ?? "bg.subtle")}
    >
      <Text
        textStyle={emphasis ? "xl" : "lg"}
        fontWeight="semibold"
        color={colors?.fg ?? "fg"}
        lineHeight="1.2"
      >
        {value}
      </Text>
      <Text textStyle="xs" color="fg.muted">
        {label}
      </Text>
    </VStack>
  );

  if (!hint) return body;
  return (
    <Tooltip content={hint} positioning={{ placement: "top" }}>
      {body}
    </Tooltip>
  );
}

function MetaChip({ children }: { children: ReactNode }) {
  return (
    <Text
      textStyle="xs"
      fontFamily="mono"
      color="fg.muted"
      paddingX={2}
      paddingY={0.5}
      borderWidth="1px"
      borderColor="border"
      borderRadius="sm"
      bg="bg.subtle"
    >
      {children}
    </Text>
  );
}
