/**
 * The setup band before a run's conversation and the teardown band after it (ADR-180). Each band
 * has one title line (phase, status, time, trace) over a tinted block of state.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { ChipTone } from "@langwatch/design-system/chip";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { Box, Button, HStack, Icon, Text, VStack } from "@langwatch/design-system/primitives";
import type { ScenarioHookResult } from "@langwatch/scenario-contract";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CircleSlash,
  Clock,
  DatabaseZap,
  type LucideIcon,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";

import { formatHookDuration, formatStateValue, type HookTone } from "../../model/run-hooks.ts";

const TONE_FG: Record<HookTone, string> = {
  ok: "green.fg",
  warn: "orange.fg",
  danger: "red.fg",
  muted: "fg.muted",
};

const TONE_EDGE: Record<HookTone, string> = {
  ok: "green.solid",
  warn: "orange.solid",
  danger: "red.solid",
  muted: "border.emphasized",
};

/** The chip tone of a run's hook tag ("Setup failed", "Teardown timed out"). */
export const HOOK_TAG_TONE: Record<HookTone, ChipTone> = {
  ok: "green",
  warn: "yellow",
  danger: "red",
  muted: "neutral",
};

const LEFT_BEHIND = "Test data may be left behind.";

function BandLabel({ children }: { children: ReactNode }) {
  return (
    <HStack gap={1} marginBottom={1}>
      <Text
        textStyle="2xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wider"
      >
        {children}
      </Text>
    </HStack>
  );
}

/** A hook's state, or teardown's returned object, as key/value lines. */
function KeyValues({ values, testId }: { values: Record<string, unknown>; testId: string }) {
  return (
    <VStack align="stretch" gap={0.5} data-testid={testId}>
      {Object.entries(values).map(([key, value]) => (
        <HStack key={key} gap={3} align="start" fontFamily="mono" fontSize="xs">
          <Text color="fg.muted" width="160px" flexShrink={0} truncate>
            {key}
          </Text>
          <Text color="fg" wordBreak="break-word">
            {formatStateValue(value)}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

function HookError({ error }: { error: string }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="red.solid/30"
      background="red.solid/5"
      borderRadius="md"
      paddingX={2.5}
      paddingY={2}
    >
      <Text
        as="pre"
        fontFamily="mono"
        fontSize="xs"
        color="red.fg"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
      >
        {error}
      </Text>
    </Box>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="xs" color="fg.muted">
      {children}
    </Text>
  );
}

/** One band: a coloured edge, the title line, and what the hook left. */
function HookBand({
  phase,
  icon,
  tone,
  detail,
  info,
  traceId,
  onOpenTrace,
  testId,
  children,
}: {
  phase: "Setup" | "Teardown";
  icon?: LucideIcon;
  tone: HookTone;
  detail: string;
  info?: string;
  traceId?: string;
  onOpenTrace?: (traceId: string) => void;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <Box
      data-testid={testId}
      borderTopWidth="1px"
      borderColor="border.muted"
      borderLeftWidth="3px"
      borderLeftColor={TONE_EDGE[tone]}
      background="bg.subtle"
      paddingX={4}
      paddingY={2.5}
    >
      <HStack gap={2} fontSize="xs">
        <Text
          textStyle="2xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          {phase}
        </Text>
        {/* A real space, so the band reads "Setup failed" to screen readers. */}{" "}
        <HStack gap={1} color={TONE_FG[tone]} fontWeight="medium">
          {icon && <Icon as={icon} boxSize={3.5} />}
          <Text>{detail}</Text>
        </HStack>
        {info && <FieldInfoTooltip description={info} trigger="hover" />}
        {traceId && onOpenTrace && (
          <Button
            size="2xs"
            variant="plain"
            color="blue.fg"
            paddingX={0}
            onClick={() => onOpenTrace(traceId)}
            aria-label={`Open the ${phase.toLowerCase()} trace`}
          >
            Trace
            <Icon as={ArrowUpRight} boxSize={3} />
          </Button>
        )}
      </HStack>
      {children && (
        <VStack align="stretch" gap={2.5} marginTop={2}>
          {children}
        </VStack>
      )}
    </Box>
  );
}

function hasKeys(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return value !== undefined && Object.keys(value).length > 0;
}

function TooLarge({ what }: { what: string }) {
  return <Note>{what} was over 64 KiB, so the run keeps no copy of it.</Note>;
}

/** How a band's title line reads one status: its icon, colour and word, and whether time shows. */
interface BandFrame {
  icon: LucideIcon;
  tone: HookTone;
  word: string | null;
  timed: boolean;
}

function detailOf({ frame, durationMs }: { frame: BandFrame; durationMs: number }): string {
  const duration = formatHookDuration(durationMs);
  if (frame.word === null) return duration;
  return frame.timed ? `${frame.word} ${duration}` : frame.word;
}

const SETUP_FRAME: Record<ScenarioHookResult["status"], BandFrame> = {
  ok: { icon: Check, tone: "ok", word: null, timed: true },
  failed: { icon: AlertTriangle, tone: "danger", word: "failed", timed: true },
  timed_out: { icon: Clock, tone: "warn", word: "timed out", timed: true },
  // No instance took the call: setup never answered, which reads as a failed setup.
  not_run: { icon: AlertTriangle, tone: "danger", word: "failed", timed: false },
  skipped: { icon: CircleSlash, tone: "muted", word: "skipped", timed: false },
};

/** The setup band: the state the run started from, or why there was none. */
export function SetupBand({
  result,
  onOpenTrace,
}: {
  result: ScenarioHookResult;
  onOpenTrace?: (traceId: string) => void;
}) {
  const ok = result.status === "ok";
  const frame = SETUP_FRAME[result.status];
  return (
    <HookBand
      phase="Setup"
      icon={frame.icon}
      tone={frame.tone}
      detail={detailOf({ frame, durationMs: result.durationMs })}
      traceId={result.traceId}
      onOpenTrace={onOpenTrace}
      testId="hook-band-setup"
    >
      {hasKeys(result.state) && (
        <Box>
          <BandLabel>
            {ok ? "State at start" : "State before it stopped"}
            {ok && (
              <FieldInfoTooltip
                description="Your setup returned this. The simulated user and the judge see it, and each turn can change it."
                trigger="hover"
              />
            )}
          </BandLabel>
          <KeyValues values={result.state} testId="hook-setup-state" />
        </Box>
      )}
      {result.stateTooLarge && <TooLarge what="The state" />}
      {!ok && result.error && <HookError error={result.error} />}
      {ok && !hasKeys(result.state) && !result.stateTooLarge && <Note>No state returned.</Note>}
    </HookBand>
  );
}

const TEARDOWN_FRAME: Record<ScenarioHookResult["status"], BandFrame> = {
  ok: { icon: Check, tone: "ok", word: null, timed: true },
  // The record keeps `timed_out`; the run reads it as a failed teardown, with the timeout error.
  failed: { icon: AlertTriangle, tone: "danger", word: "failed", timed: true },
  timed_out: { icon: AlertTriangle, tone: "danger", word: "failed", timed: true },
  not_run: { icon: WifiOff, tone: "warn", word: "not run", timed: false },
  skipped: { icon: DatabaseZap, tone: "muted", word: "skipped", timed: false },
};

/** The teardown band: what it returned, or the error, the state it was given and the warning. */
export function TeardownBand({
  result,
  onOpenTrace,
}: {
  result: ScenarioHookResult;
  onOpenTrace?: (traceId: string) => void;
}) {
  const frame = TEARDOWN_FRAME[result.status];
  const failed = result.status === "failed" || result.status === "timed_out";
  const ran = result.status === "ok" || failed;
  return (
    <HookBand
      phase="Teardown"
      icon={frame.icon}
      tone={frame.tone}
      detail={detailOf({ frame, durationMs: result.durationMs })}
      info="Teardown does not change the score."
      traceId={ran ? result.traceId : undefined}
      onOpenTrace={onOpenTrace}
      testId="hook-band-teardown"
    >
      {result.status === "ok" && hasKeys(result.returned) && (
        <Box>
          <BandLabel>
            Returned by teardown
            <FieldInfoTooltip
              description="Whatever your teardown returns is shown here. Optional."
              trigger="hover"
            />
          </BandLabel>
          <KeyValues values={result.returned} testId="hook-teardown-returned" />
        </Box>
      )}
      {result.returnedTooLarge && <TooLarge what="What teardown returned" />}
      {failed && hasKeys(result.state) && (
        <Box>
          <BandLabel>State given to teardown</BandLabel>
          <KeyValues values={result.state} testId="hook-teardown-state" />
        </Box>
      )}
      {failed && result.stateTooLarge && <TooLarge what="The state given to teardown" />}
      {result.error && result.status !== "ok" && <HookError error={result.error} />}
      {(failed || result.status === "not_run") && <Note>{LEFT_BEHIND}</Note>}
      {result.status === "skipped" && <Note>Rerun and keep data: test data left in place.</Note>}
    </HookBand>
  );
}

/** A finished run on an agent that declares no setup or teardown. */
export function NoHooksBand() {
  return (
    <HookBand
      phase="Setup"
      icon={CircleSlash}
      tone="muted"
      detail="No hooks"
      info="This agent declares no setup or teardown, so the run started with no test data."
      testId="hook-band-none"
    />
  );
}
