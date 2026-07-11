import { Box, Grid, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import { formatCost } from "../../../utils/formatters";
import {
  deriveSessionSignals,
  formatCompact,
  formatShortDuration,
  type SessionSignal,
} from "./sessionSignals";
import { TokenTimelineChart } from "./TokenTimelineChart";
import { deriveTokenTimeline, findCacheRebuilds } from "./tokenTimeline";

/**
 * The session overview for a coding agent.
 *
 * A coding-agent trace is a SESSION, not an exchange: hundreds of spans, dozens
 * of model calls, a hundred tool runs. The Terminal tab replays it moment by
 * moment, which is the right way to read what happened but the wrong way to
 * answer "was this session healthy, and what did it cost me". This is the other
 * half — the same session, folded.
 *
 * Everything here comes from one pre-folded row (ADR-040), so the screen costs a
 * single point read rather than re-walking 800 spans in the browser.
 */

interface SessionViewProps {
  session: CodingAgentSessionRow;
  /**
   * The session's transcript entries, for the per-call token timeline. The
   * fold above is a bounded aggregate (ADR-040) — it has the SUM of cache
   * reused/rebuilt but not the "where". Optional: without it the timeline
   * section is simply omitted rather than the whole tab failing.
   */
  entries?: TranscriptEntry[];
}

export function SessionView({ session, entries }: SessionViewProps) {
  const signals = useMemo(() => deriveSessionSignals(session), [session]);
  const tokenTimeline = useMemo(
    () => (entries ? deriveTokenTimeline(entries) : []),
    [entries],
  );
  const cacheRebuilds = useMemo(
    () => (entries ? findCacheRebuilds(entries) : []),
    [entries],
  );

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
            <ToolTable
              counts={session.toolCounts}
              durations={session.toolDurationMs}
            />
          </Section>
        )}

        <Extensions session={session} />

        <Outcome session={session} />
      </VStack>
    </Box>
  );
}

function Headline({ session }: { session: CodingAgentSessionRow }) {
  const wasted = session.cacheCreationTokens;
  const reused = session.cacheReadTokens;

  return (
    <VStack align="stretch" gap={3}>
      <HStack gap={2} flexWrap="wrap">
        {session.agent && <MetaChip>{session.agent}</MetaChip>}
        {session.agentVersion && <MetaChip>v{session.agentVersion}</MetaChip>}
        {session.models.map((model) => (
          <MetaChip key={model}>{model}</MetaChip>
        ))}
        {session.entrypoint && <MetaChip>{session.entrypoint}</MetaChip>}
      </HStack>

      <Grid
        templateColumns="repeat(auto-fit, minmax(120px, 1fr))"
        gap={3}
        alignItems="stretch"
      >
        <Stat label="Cost" value={formatCost(session.costUsd)} emphasis />
        <Stat label="Model calls" value={String(session.modelCalls)} />
        <Stat label="Tools run" value={String(session.toolCalls)} />
        {session.subAgents > 0 && (
          <Stat label="Sub-agents" value={String(session.subAgents)} />
        )}
        <Stat label="Files touched" value={String(session.filesTouched.length)} />
        {/*
          Reused vs rebuilt, side by side — because that comparison IS the number.
          A big cache-read count is the session working as intended; a big rebuild
          count next to it is the session paying twice for the same context.
        */}
        <Stat
          label="Context reused"
          value={formatCompact(reused)}
          hint="Tokens served from the cache. These bill at a fraction of fresh input — the more the better."
        />
        <Stat
          label="Context rebuilt"
          value={formatCompact(wasted)}
          hint="Tokens spent writing the cache again. Rebuilding costs MORE per token than fresh input, so this is the number to keep small."
          tone={wasted > 0 && reused > 0 && wasted / reused >= 0.25 ? "warning" : undefined}
        />
      </Grid>
    </VStack>
  );
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
          borderColor={
            signal.tone === "danger"
              ? "red.solid/30"
              : signal.tone === "warning"
                ? "yellow.solid/30"
                : "border"
          }
          bg={
            signal.tone === "danger"
              ? "red.solid/8"
              : signal.tone === "warning"
                ? "yellow.solid/8"
                : "bg.subtle"
          }
        >
          <Box
            width="3px"
            alignSelf="stretch"
            borderRadius="full"
            bg={
              signal.tone === "danger"
                ? "red.solid"
                : signal.tone === "warning"
                  ? "yellow.solid"
                  : "border.emphasized"
            }
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
 * The order things happened, batched.
 *
 * Counts alone ("Bash 9, Edit 9, Read 2") lose the story. The sequence keeps it:
 * it read the files, ran the tests, fixed one, ran them again. A failed step is
 * marked where it failed rather than hoisted out of order.
 */
function Steps({ steps }: { steps: [string, number, boolean][] }) {
  if (steps.length === 0) {
    return (
      <Text textStyle="xs" color="fg.muted">
        No tools were run — the agent answered from what it already knew.
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
            <Text
              textStyle="xs"
              fontFamily="mono"
              color={failed ? "red.fg" : "fg.muted"}
            >
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
function TimeBreakdown({ session }: { session: CodingAgentSessionRow }) {
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
        No timing was reported for this session.
      </Text>
    );
  }

  const meanTtft =
    session.ttftSamples > 0 ? session.ttftMsTotal / session.ttftSamples : null;

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
          Typically {formatShortDuration(meanTtft)} before the model started
          replying.
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
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const busiest = rows[0]?.[1] ?? 1;

  return (
    <VStack align="stretch" gap={1}>
      {rows.map(([tool, count]) => (
        <HStack key={tool} gap={3}>
          <Text
            textStyle="xs"
            fontFamily="mono"
            color="fg"
            width="140px"
            flexShrink={0}
            truncate
          >
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
          <Text
            textStyle="xs"
            color="fg.subtle"
            width="60px"
            textAlign="right"
            flexShrink={0}
          >
            {durations[tool] ? formatShortDuration(durations[tool]) : "—"}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * What the session reached for beyond its built-in tools. Empty for most
 * sessions, and when it isn't, this is usually the interesting part: an MCP
 * server that got used once, a skill that fired, a sub-agent type nobody knew
 * was running.
 */
function Extensions({ session }: { session: CodingAgentSessionRow }) {
  const groups = [
    { label: "MCP servers", values: session.mcpServers },
    { label: "MCP tools", values: session.mcpTools },
    { label: "Skills", values: session.skills },
    { label: "Commands", values: session.slashCommands },
    { label: "Sub-agents", values: session.subAgentTypes },
  ].filter((group) => group.values.length > 0);

  if (groups.length === 0) return null;

  return (
    <Section title="Reached for">
      <VStack align="stretch" gap={2}>
        {groups.map((group) => (
          <HStack key={group.label} align="start" gap={3}>
            <Text
              textStyle="xs"
              color="fg.muted"
              width="100px"
              flexShrink={0}
              paddingTop={1}
            >
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
function Outcome({ session }: { session: CodingAgentSessionRow }) {
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
              {session.languagesEdited.length > 0 &&
                ` of ${session.languagesEdited.join(", ")}`}
            </Text>
          </HStack>
        )}
        {session.commits > 0 && (
          <Stat label="Commits" value={String(session.commits)} compact />
        )}
        {session.pullRequests > 0 && (
          <Stat
            label="Pull requests"
            value={String(session.pullRequests)}
            compact
          />
        )}
        {hasReview && (
          <Text textStyle="xs" color="fg.muted">
            You kept {session.editsAccepted} of{" "}
            {session.editsAccepted + session.editsRejected} suggested edits
          </Text>
        )}
      </HStack>
    </Section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
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
  tone?: "warning";
}) {
  const body = (
    <VStack
      align="start"
      gap={0}
      padding={compact ? 0 : 3}
      borderWidth={compact ? 0 : "1px"}
      borderColor={tone === "warning" ? "yellow.solid/30" : "border"}
      borderRadius="md"
      bg={compact ? undefined : tone === "warning" ? "yellow.solid/8" : "bg.subtle"}
    >
      <Text
        textStyle={emphasis ? "xl" : "lg"}
        fontWeight="semibold"
        color={tone === "warning" ? "yellow.fg" : "fg"}
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
