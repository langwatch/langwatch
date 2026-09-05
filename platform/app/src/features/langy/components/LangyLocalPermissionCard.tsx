/**
 * The permission card (ADR-129) — Langy wants to run one command on the
 * developer's machine, and the turn is holding until they answer.
 *
 * The command line is the trust boundary: it decides what needs asking, it
 * keeps the folder limit and the privilege rule whatever is answered here, and
 * this card only carries the answer back. The one thing the server rules on is
 * the skip switch, and only whether the model behind the conversation is on
 * its provider's allowed list.
 *
 * Four states, all read from the wait itself so a reload shows the same thing:
 * pending (the three answers and the skip switch), answered (what was picked),
 * expired (nobody answered in time), cancelled (the turn was stopped).
 */
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, CircleSlash, Clock, Terminal } from "lucide-react";
import { useState } from "react";

import { Switch } from "~/components/ui/switch";
import { Tooltip } from "~/components/ui/tooltip";
import { describeError } from "~/features/errors";
import { api } from "~/utils/api";

import type {
  LangyPermissionAnswerSource,
  LangyPermissionCardData,
  LangyPermissionDecision,
} from "../logic/langyLocalWaits";
import { useLangyLocalControlStore } from "../stores/langyLocalControlStore";

/** What the disabled skip switch says, and where it sends the reader. */
export const SKIP_NOT_ALLOWED_HINT =
  "This model is not allowed to skip permission checks. Check the allowed models list in the provider settings.";

/**
 * The patterns as one phrase: "git fetch" and "git checkout".
 *
 * Every pattern, never the first one alone. One click on the session grant
 * covers each part of the chain that is not read-only, and the session's
 * grants are readable nowhere else, so a button that named one of three was
 * giving away two the reader never saw.
 */
export function langyPatternList(patterns: readonly string[]): string {
  const quoted = patterns
    .filter((pattern) => pattern !== "")
    .map((pattern) => `"${pattern}"`);
  if (quoted.length === 0) return "";
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]!}`;
}

/**
 * What the settled card says the reader did. A pattern grant NAMES the
 * patterns: they cover every future command that matches them, and the
 * session's grants are readable nowhere else, so "this pattern" left the
 * reader with no way to know what they had given away.
 *
 * An ask can also be answered in the terminal that shares the folder, and the
 * reader looking at the card did not see that happen. The card then says where
 * the answer came from, so a card that settled on its own is not a mystery.
 */
export function langyDecisionLabel({
  decision,
  patterns,
  source,
}: {
  decision: LangyPermissionDecision | null;
  patterns: readonly string[];
  source?: LangyPermissionAnswerSource | null;
}): string {
  if (source === "terminal") {
    return `Answered in the terminal: ${terminalAnswer({ decision, patterns })}`;
  }
  if (decision === "allow_once") return "You allowed this command once";
  if (decision === "deny") return "You denied this command";
  if (decision === "allow_pattern") {
    const named = langyPatternList(patterns);
    return named
      ? `You allowed ${named} for the session`
      : "You allowed this pattern for the session";
  }
  return "You answered this card";
}

/** The second half of the terminal line: what the developer chose there. */
function terminalAnswer({
  decision,
  patterns,
}: {
  decision: LangyPermissionDecision | null;
  patterns: readonly string[];
}): string {
  if (decision === "allow_once") return "allowed this command once";
  if (decision === "deny") return "denied this command";
  if (decision === "allow_pattern") {
    const named = langyPatternList(patterns);
    return named
      ? `allowed ${named} for this session`
      : "allowed this pattern for this session";
  }
  return "answered";
}

/**
 * The time limit in the reader's words: "5 minutes", "90 seconds". Whole
 * minutes read as minutes, and anything else reads as seconds, so the card
 * never rounds a limit the command actually runs under.
 */
export function langyTimeLimitText(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

export interface LangyLocalPermissionCardProps {
  projectId: string;
  conversationId: string;
  card: LangyPermissionCardData;
  /** The server's answer on the model gate, from `langy.getLocalWorkspace`. */
  skipAllowed: boolean;
  /** Permission checks are already off for this session. */
  skipPermissions: boolean;
  /** Absent = read-only (time travel, a shared view). */
  answerable?: boolean;
}

export function LangyLocalPermissionCard({
  projectId,
  conversationId,
  card,
  skipAllowed,
  skipPermissions,
  answerable = true,
}: LangyLocalPermissionCardProps) {
  const settleWait = useLangyLocalControlStore((s) => s.settleWait);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = card.status === "pending" && answerable;

  return (
    <Box
      data-testid="langy-permission-card"
      data-status={card.status}
      borderWidth="1px"
      borderColor={pending ? "orange.emphasized" : "border.muted"}
      borderRadius="md"
      padding={3}
      maxWidth="420px"
      background="bg.subtle"
    >
      <VStack align="stretch" gap={2}>
        <HStack gap={2}>
          <Box color="fg.muted" display="flex" flexShrink={0}>
            <Terminal size={14} />
          </Box>
          <Text textStyle="xs" fontWeight="640" color="fg">
            Langy wants to run on {card.hostname ?? "your machine"} in{" "}
            {card.workspaceName ?? "the folder you shared"}
          </Text>
        </HStack>

        {/* The whole command, wrapped. It used to scroll sideways inside a
            420px card, so a chain that stages, commits, pushes and opens a
            pull request was approved from its first few words. Nobody can
            rule on text they cannot read. */}
        <Box
          as="pre"
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          background="bg.muted"
          paddingX={2}
          paddingY={1.5}
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          <Text
            as="code"
            textStyle="2xs"
            fontFamily="mono"
            color="fg"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
          >
            {card.command}
          </Text>
        </Box>

        {card.reason ? (
          <Text textStyle="2xs" color="fg.muted">
            {card.reason}
          </Text>
        ) : null}

        {/* The limit the command runs under. A command that reached it came
            back with nothing to show and no reason the reader could see. */}
        {card.timeoutSeconds ? (
          <Text textStyle="2xs" color="fg.subtle">
            Stops after {langyTimeLimitText(card.timeoutSeconds)} if it has not
            finished.
          </Text>
        ) : null}

        {pending ? (
          <PendingAnswers
            projectId={projectId}
            conversationId={conversationId}
            card={card}
            skipAllowed={skipAllowed}
            skipPermissions={skipPermissions}
            onSettled={(decision) =>
              settleWait({ waitId: card.waitId, status: "answered", decision })
            }
            onFailure={setFailure}
          />
        ) : (
          <Outcome card={card} />
        )}

        {failure ? (
          <Text textStyle="2xs" color="red.fg" role="alert">
            {failure}
          </Text>
        ) : null}
      </VStack>
    </Box>
  );
}

/** The three answers, and the one choice that stops the cards for a session. */
function PendingAnswers({
  projectId,
  conversationId,
  card,
  skipAllowed,
  skipPermissions,
  onSettled,
  onFailure,
}: {
  projectId: string;
  conversationId: string;
  card: LangyPermissionCardData;
  skipAllowed: boolean;
  skipPermissions: boolean;
  onSettled: (decision: LangyPermissionDecision) => void;
  onFailure: (message: string | null) => void;
}) {
  const answer = api.langy.answerLocalPermission.useMutation({
    onError: (error) =>
      onFailure(
        describeError({ error, fallbackTitle: "Could not send your answer" }),
      ),
  });
  const setPolicy = api.langy.setLocalPolicy.useMutation({
    onError: (error) =>
      onFailure(
        describeError({
          error,
          fallbackTitle: "Could not change the permission checks",
        }),
      ),
  });

  // The decision travels with the settle: the durable record needs a moment to
  // carry it back, and until it does the card would say only that it was
  // answered, which is the one thing the reader already knows.
  const decide = (decision: LangyPermissionDecision) => {
    onFailure(null);
    answer.mutate(
      { projectId, conversationId, waitId: card.waitId, decision },
      { onSuccess: () => onSettled(decision) },
    );
  };

  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={1.5} flexWrap="wrap">
        <Button
          size="xs"
          colorPalette="orange"
          loading={answer.isPending}
          onClick={() => decide("allow_once")}
        >
          Allow once
        </Button>
        {card.patterns.length > 0 ? (
          <Button
            size="xs"
            variant="outline"
            loading={answer.isPending}
            onClick={() => decide("allow_pattern")}
          >
            Allow {langyPatternList(card.patterns)} this session
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          loading={answer.isPending}
          onClick={() => decide("deny")}
        >
          Deny
        </Button>
      </HStack>

      {card.skipOffered ? (
        <SkipSwitch
          allowed={skipAllowed}
          checked={skipPermissions}
          busy={setPolicy.isPending}
          onChange={(next) => {
            onFailure(null);
            setPolicy.mutate({
              projectId,
              conversationId,
              skipPermissions: next,
            });
          }}
        />
      ) : null}
    </VStack>
  );
}

/** What the card says once it is no longer waiting for anybody. */
function Outcome({ card }: { card: LangyPermissionCardData }) {
  if (card.status === "answered") {
    return (
      <HStack gap={1.5}>
        <Box color="fg.muted" display="flex">
          {card.decision === "deny" ? (
            <CircleSlash size={12} />
          ) : (
            <Check size={12} />
          )}
        </Box>
        <Text textStyle="2xs" color="fg.muted">
          {langyDecisionLabel({
            decision: card.decision,
            patterns: card.patterns,
            source: card.source,
          })}
        </Text>
      </HStack>
    );
  }
  if (card.status === "expired") {
    return (
      <HStack gap={1.5}>
        <Box color="fg.muted" display="flex">
          <Clock size={12} />
        </Box>
        <Text textStyle="2xs" color="fg.muted">
          No answer in time, Langy continued without it
        </Text>
      </HStack>
    );
  }
  return (
    <Text textStyle="2xs" color="fg.muted">
      Cancelled with the turn
    </Text>
  );
}

/**
 * One explicit choice per session, and the server gates it on the model. When
 * the model is not allowed the switch is off and says why, rather than
 * accepting a click the server would refuse.
 */
function SkipSwitch({
  allowed,
  checked,
  busy,
  onChange,
}: {
  allowed: boolean;
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  const label = "Skip all permission checks this session (I accept the risk)";
  const control = (
    <Switch
      size="sm"
      data-testid="langy-skip-permissions-switch"
      checked={checked}
      disabled={!allowed || busy}
      inputProps={{
        "data-testid": "langy-skip-permissions",
        "aria-label": label,
      }}
      onCheckedChange={(event) => onChange(event.checked === true)}
    >
      <Text textStyle="2xs" color="fg.muted">
        {label}
      </Text>
    </Switch>
  );

  if (allowed) return control;
  // The reason travels on the element itself as well as in the tooltip: a
  // disabled control with no readable reason is a dead end, and a hover is
  // not available to everyone reading it.
  return (
    <Tooltip content={SKIP_NOT_ALLOWED_HINT} positioning={{ placement: "top" }}>
      <Box title={SKIP_NOT_ALLOWED_HINT} opacity={0.6}>
        {control}
      </Box>
    </Tooltip>
  );
}
