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
  LangyPermissionCardData,
  LangyPermissionDecision,
} from "../logic/langyLocalWaits";
import { useLangyLocalControlStore } from "../stores/langyLocalControlStore";

/** What the disabled skip switch says, and where it sends the reader. */
export const SKIP_NOT_ALLOWED_HINT =
  "This model is not allowed to skip permission checks. Check the allowed models list in the provider settings.";

const DECISION_LABEL: Record<LangyPermissionDecision, string> = {
  allow_once: "You allowed this command once",
  allow_pattern: "You allowed this pattern for the session",
  deny: "You denied this command",
};

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

        <Box
          as="pre"
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          background="bg.muted"
          paddingX={2}
          paddingY={1.5}
          overflowX="auto"
        >
          <Text as="code" textStyle="2xs" fontFamily="mono" color="fg">
            {card.command}
          </Text>
        </Box>

        {card.reason ? (
          <Text textStyle="2xs" color="fg.muted">
            {card.reason}
          </Text>
        ) : null}

        {pending ? (
          <PendingAnswers
            projectId={projectId}
            conversationId={conversationId}
            card={card}
            skipAllowed={skipAllowed}
            skipPermissions={skipPermissions}
            onSettled={() =>
              settleWait({ waitId: card.waitId, status: "answered" })
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
  onSettled: () => void;
  onFailure: (message: string | null) => void;
}) {
  const answer = api.langy.answerLocalPermission.useMutation({
    onSuccess: onSettled,
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

  const decide = (decision: LangyPermissionDecision) => {
    onFailure(null);
    answer.mutate({ projectId, conversationId, waitId: card.waitId, decision });
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
        {card.pattern ? (
          <Button
            size="xs"
            variant="outline"
            loading={answer.isPending}
            onClick={() => decide("allow_pattern")}
          >
            Allow &quot;{card.pattern}&quot; this session
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
          {card.decision
            ? DECISION_LABEL[card.decision]
            : "You answered this card"}
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
