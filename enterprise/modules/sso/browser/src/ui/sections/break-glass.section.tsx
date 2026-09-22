// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The way back in (D05): one named person who can still sign in with a
 * password if the identity provider stops working. Never plan-gated, unlike
 * everything else on this page — a lapsed subscription must never be the
 * reason an organization cannot reach its own recovery path.
 */
import { Button, HStack, Input, NativeSelect, Table, Text, VStack } from "@chakra-ui/react";
import { BREAK_GLASS_MAX_WINDOW_DAYS } from "@langwatch/identity-contract";
import { format } from "@langwatch/time";
import { useState } from "react";

import { endOfLocalDay, localIsoDateInDays } from "../../model/break-glass-dates.ts";
import {
  breakGlassCandidateLabel,
  breakGlassHolderName,
  liveBreakGlassGrants,
  type BreakGlassCandidateView,
  type BreakGlassGrantView,
} from "../../model/break-glass-grants.ts";
import { CopyValueRow } from "../elements/copy-value-row.tsx";
import { SettingsCard } from "../elements/settings-card.tsx";

/**
 * Thirty days, not the ninety the window allows: a default should be the
 * answer somebody would have picked, and the longest permitted grant is the
 * most dangerous one the rules still allow.
 */
const BREAK_GLASS_DEFAULT_DAYS = 30;

/**
 * A day inside the window rather than on it: the end of `today + 89` is
 * always before `now + 90 days`, while the end of `today + 90` never is — so
 * offering the maximum offered a date the server was bound to refuse.
 */
const BREAK_GLASS_LAST_OFFERED_DAYS = BREAK_GLASS_MAX_WINDOW_DAYS - 1;

export function BreakGlassSection({
  canManage,
  grants,
  candidates,
  granting = false,
  settlingBindingId = null,
  onGrant,
  onRenew,
  onRevoke,
}: {
  canManage: boolean;
  grants: readonly BreakGlassGrantView[];
  /** Who it can be granted to. Read only where somebody may grant one. */
  candidates: readonly BreakGlassCandidateView[];
  granting?: boolean;
  /** The row whose change is in flight, so only that row reads as busy. */
  settlingBindingId?: string | null;
  onGrant: (command: { userId: string; expiresAtMs: number }) => void;
  onRenew: (command: { bindingId: string; expiresAtMs: number }) => void;
  onRevoke: (command: { bindingId: string }) => void;
}) {
  const [userId, setUserId] = useState("");
  const [endsOn, setEndsOn] = useState(localIsoDateInDays(BREAK_GLASS_DEFAULT_DAYS));
  const live = liveBreakGlassGrants(grants);

  return (
    <SettingsCard
      title="Name someone who can still get in"
      hint="The one way in that does not go through your identity provider."
      testId="connection-break-glass"
    >
      <Text color="fg.muted" fontSize="sm" maxWidth="72ch">
        Once single sign-on decides who gets in, everyone goes through your identity provider. Name
        one person who can still sign in with a password if it ever stops working, so nobody has to
        wait for us to let them back into their own organization.
      </Text>

      {live.length === 0 ? (
        <Text color="fg.muted" fontSize="sm">
          Nobody can get in without your identity provider yet.
        </Text>
      ) : (
        <Table.Root size="sm" data-testid="connection-break-glass-table">
          <Table.Header>
            <Table.Row background="transparent">
              <Table.ColumnHeader>Who</Table.ColumnHeader>
              <Table.ColumnHeader>Until</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {live.map((grant) => (
              <GrantRow
                key={grant.bindingId}
                grant={grant}
                canManage={canManage}
                settling={settlingBindingId === grant.bindingId}
                onRenew={() =>
                  onRenew({ bindingId: grant.bindingId, expiresAtMs: endOfLocalDay(endsOn) })
                }
                onRevoke={() => onRevoke({ bindingId: grant.bindingId })}
              />
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {live.length > 0 && <WhereTheyGetIn />}

      {canManage && (
        <VStack align="stretch" gap={2}>
          <GrantForm
            candidates={candidates}
            userId={userId}
            onUserIdChange={setUserId}
            endsOn={endsOn}
            onEndsOnChange={setEndsOn}
            pending={granting}
            onGrant={() => {
              onGrant({ userId, expiresAtMs: endOfLocalDay(endsOn) });
              setUserId("");
            }}
          />
          <Text fontSize="sm" color="fg.muted">
            Every grant has an end date, so one that is no longer needed stops being a second way in
            on its own. We warn whoever can renew it before it ends.
          </Text>
        </VStack>
      )}
    </SettingsCard>
  );
}

/**
 * The address a grant is actually spent at. A WAY BACK IN NOBODY CAN FIND IS
 * NOT A WAY BACK IN: once the connection is live the front door hands every
 * visitor to the identity provider, and the password form survives at exactly
 * one address. Drawn as a value to carry, because its holder is not here.
 */
function WhereTheyGetIn() {
  return (
    <VStack align="stretch" gap={2} data-testid="connection-break-glass-address">
      <Text color="fg.muted" fontSize="sm" maxWidth="72ch">
        Send this address to whoever you named. The ordinary sign-in page hands everyone to your
        identity provider, so this is the one that still asks for a password. It is not linked from
        anywhere else, by design.
      </Text>
      <CopyValueRow
        label="Where they sign in"
        value={`${window.location.origin}/auth/signin?local=1`}
      />
    </VStack>
  );
}

/** The three fields a new grant takes: who, until when, and the button. */
function GrantForm({
  candidates,
  userId,
  onUserIdChange,
  endsOn,
  onEndsOnChange,
  pending,
  onGrant,
}: {
  candidates: readonly BreakGlassCandidateView[];
  userId: string;
  onUserIdChange: (next: string) => void;
  endsOn: string;
  onEndsOnChange: (next: string) => void;
  pending: boolean;
  onGrant: () => void;
}) {
  return (
    <HStack>
      <NativeSelect.Root>
        <NativeSelect.Field
          value={userId}
          onChange={(event) => onUserIdChange(event.target.value)}
          aria-label="Who can still get in"
        >
          <option value="">Choose an administrator</option>
          {candidates.map((person) => (
            <option
              key={person.userId}
              value={person.userId}
              disabled={person.holdsPassword === false}
            >
              {breakGlassCandidateLabel(person)}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {/* Bounded to the window the server enforces, so the picker cannot
          offer a date that is going to be refused. The refusal stays the
          backstop — a date typed rather than picked still reaches it. */}
      <Input
        type="date"
        value={endsOn}
        aria-label="Until"
        min={localIsoDateInDays(1)}
        max={localIsoDateInDays(BREAK_GLASS_LAST_OFFERED_DAYS)}
        onChange={(event) => onEndsOnChange(event.target.value)}
      />
      <Button flexShrink={0} loading={pending} disabled={!userId || !endsOn} onClick={onGrant}>
        Grant a way back in
      </Button>
    </HStack>
  );
}

/** One live grant: who, until when, and the two things that can be done to
 *  it — extended to the picked date, or ended now. */
function GrantRow({
  grant,
  canManage,
  settling,
  onRenew,
  onRevoke,
}: {
  grant: BreakGlassGrantView;
  canManage: boolean;
  settling: boolean;
  onRenew: () => void;
  onRevoke: () => void;
}) {
  return (
    <Table.Row data-testid="connection-break-glass-row">
      <Table.Cell verticalAlign="top">
        <VStack align="start" gap={0}>
          <Text>{breakGlassHolderName(grant)}</Text>
          {grant.grantedByName && (
            <Text fontSize="sm" color="fg.muted">
              Granted by {grant.grantedByName}
            </Text>
          )}
        </VStack>
      </Table.Cell>
      <Table.Cell verticalAlign="top">
        <VStack align="start" gap={0}>
          {/* The month in words: a numeric date is read day-first by half the
              world and month-first by the other half, directly under a date
              input that renders in the browser's own locale. */}
          <Text>{format(grant.expiresAtMs, "d MMMM yyyy")}</Text>
          <Text fontSize="sm" color="fg.muted">
            {grant.daysRemaining} days left
          </Text>
        </VStack>
      </Table.Cell>
      <Table.Cell verticalAlign="top">
        {canManage && (
          <HStack gap={2} justify="end">
            <Button size="xs" variant="outline" loading={settling} onClick={onRenew}>
              Extend to the date below
            </Button>
            {/* Refused server-side while it is a live connection's only way
                back in, with copy saying what to do — which is why this needs
                no confirm step: the dangerous case cannot go through. */}
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              _hover={{ color: "red.solid" }}
              loading={settling}
              onClick={onRevoke}
            >
              End now
            </Button>
          </HStack>
        )}
      </Table.Cell>
    </Table.Row>
  );
}
