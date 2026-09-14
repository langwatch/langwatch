import {
  Button,
  HStack,
  Input,
  NativeSelect,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SelfServeBreakGlassBindingView } from "@langwatch/identity-server";
import { useState } from "react";
import { api } from "../../../utils/api";
import { SettingsRowsSkeleton } from "../kit/SettingsSkeleton";
import { LoadFailure, reportRefusal } from "./refusals";

/**
 * The way back in (D05).
 *
 * Described in what it does for the reader — one named person can still sign
 * in with a password if the identity provider stops working — and never in
 * what it is called internally. Somebody reading this screen for the first
 * time is deciding whether they trust us with their auth screens, and a term
 * of art in the middle of that sentence is a term they have to go and look
 * up.
 *
 * Not plan-gated, deliberately and unlike everything else on this page: a
 * lapsed subscription must never be the reason an organization cannot reach
 * its own recovery path. The router agrees — `grantBreakGlass` and
 * `renewBreakGlass` carry `sso:manage` and no plan check.
 */
export function BreakGlassSection({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const bindings = api.ssoSetup.breakGlassBindings.useQuery({ organizationId });
  const candidates = api.ssoSetup.breakGlassCandidates.useQuery(
    { organizationId },
    { enabled: canManage },
  );
  const grant = api.ssoSetup.grantBreakGlass.useMutation();
  const utils = api.useUtils();

  const [userId, setUserId] = useState("");
  const [endsOn, setEndsOn] = useState(defaultEndDate());

  const refresh = () => {
    void utils.ssoSetup.breakGlassBindings.invalidate();
    void utils.ssoSetup.getSetup.invalidate();
  };

  const live = (bindings.data ?? []).filter((binding) => binding.live);

  return (
    <VStack align="stretch" gap={3}>
      <Text color="fg.muted" fontSize="sm">
        Once single sign-on decides who gets in, everyone goes through your
        identity provider. Name one person who can still sign in with a password
        if it ever stops working, so nobody has to wait for us to let them back
        into their own organization.
      </Text>

      {bindings.error ? (
        <LoadFailure error={bindings.error} what="the ways back in" />
      ) : bindings.isLoading ? (
        // The table's own shape while its data lands — one grant is what the
        // section usually holds, so one placeholder row is what it draws.
        <SettingsRowsSkeleton rows={1} showLead={false} />
      ) : live.length === 0 ? (
        <Text color="fg.muted" fontSize="sm">
          Nobody can get in without your identity provider yet.
        </Text>
      ) : (
        // Hairlines, not a filled band — the same table the domains two
        // steps up wear, so the two read as one screen rather than two.
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Who</Table.ColumnHeader>
              <Table.ColumnHeader>Until</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {live.map((binding) => (
              <GrantRow
                key={binding.bindingId}
                binding={binding}
                organizationId={organizationId}
                canManage={canManage}
                endsOn={endsOn}
                onSettled={refresh}
              />
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {canManage &&
        (candidates.error ? (
          <LoadFailure
            error={candidates.error}
            what="the people this can be granted to"
          />
        ) : (
          <VStack align="stretch" gap={2}>
            <GrantForm
              candidates={candidates.data ?? []}
              userId={userId}
              onUserIdChange={setUserId}
              endsOn={endsOn}
              onEndsOnChange={setEndsOn}
              pending={grant.isPending}
              onGrant={() =>
                grant.mutate(
                  { organizationId, userId, expiresAtMs: endOfDay(endsOn) },
                  {
                    onSuccess: () => {
                      setUserId("");
                      refresh();
                    },
                    onError: reportRefusal,
                  },
                )
              }
            />
            <Text fontSize="sm" color="fg.muted">
              Every grant has an end date, so one that is no longer needed stops
              being a second way in on its own. We warn whoever can renew it
              before it ends.
            </Text>
          </VStack>
        ))}
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
  candidates: Array<{
    userId: string;
    name: string | null;
    email: string | null;
  }>;
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
            <option key={person.userId} value={person.userId}>
              {person.name ?? person.email ?? person.userId}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <Input
        type="date"
        value={endsOn}
        aria-label="Until"
        onChange={(event) => onEndsOnChange(event.target.value)}
      />
      <Button loading={pending} disabled={!userId || !endsOn} onClick={onGrant}>
        Grant a way back in
      </Button>
    </HStack>
  );
}

/** One live grant: who, until when, and the two things that can be done to
 *  it — extended to the picked date, or ended now. */
function GrantRow({
  binding,
  organizationId,
  canManage,
  endsOn,
  onSettled,
}: {
  binding: SelfServeBreakGlassBindingView;
  organizationId: string;
  canManage: boolean;
  endsOn: string;
  onSettled: () => void;
}) {
  const renew = api.ssoSetup.renewBreakGlass.useMutation();
  const revoke = api.ssoSetup.revokeBreakGlass.useMutation();

  return (
    <Table.Row>
      <Table.Cell>
        <VStack align="start" gap={0}>
          <Text>{nameOf(binding)}</Text>
          {binding.grantedByName && (
            <Text fontSize="sm" color="fg.muted">
              Granted by {binding.grantedByName}
            </Text>
          )}
        </VStack>
      </Table.Cell>
      <Table.Cell>
        <VStack align="start" gap={0}>
          <Text>{new Date(binding.expiresAtMs).toLocaleDateString()}</Text>
          <Text fontSize="sm" color="fg.muted">
            {binding.daysRemaining} days left
          </Text>
        </VStack>
      </Table.Cell>
      <Table.Cell>
        {canManage && (
          <HStack gap={2} justify="end">
            <Button
              size="xs"
              variant="outline"
              loading={renew.isPending}
              onClick={() =>
                renew.mutate(
                  {
                    organizationId,
                    bindingId: binding.bindingId,
                    expiresAtMs: endOfDay(endsOn),
                  },
                  { onSuccess: onSettled, onError: reportRefusal },
                )
              }
            >
              Extend to the date below
            </Button>
            {/* Refused server-side while it is a live connection's only way
                back in, with copy saying what to do — which is why this
                needs no confirm step of its own: the dangerous case cannot
                go through. */}
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              _hover={{ color: "red.solid" }}
              loading={revoke.isPending}
              onClick={() =>
                revoke.mutate(
                  { organizationId, bindingId: binding.bindingId },
                  { onSuccess: onSettled, onError: reportRefusal },
                )
              }
            >
              End now
            </Button>
          </HStack>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

function nameOf(binding: SelfServeBreakGlassBindingView): string {
  return binding.name ?? binding.email ?? binding.userId;
}

/**
 * How far out a new way back in is offered by default.
 *
 * Long enough that granting one is not a chore somebody repeats monthly,
 * short enough that a forgotten grant does not quietly become a permanent
 * second door. The administrator can pick any date; this is only where the
 * field starts.
 */
const BREAK_GLASS_DEFAULT_DAYS = 90;

function defaultEndDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + BREAK_GLASS_DEFAULT_DAYS);
  return date.toISOString().slice(0, 10);
}

/**
 * The END of the day somebody picked, not its beginning.
 *
 * A grant made "until the 30th" that stopped working one minute past
 * midnight on the 30th would end a day before the date it says — and it
 * would do it on the one door that exists for when everything else has
 * failed.
 */
function endOfDay(isoDate: string): number {
  return new Date(`${isoDate}T23:59:59.999Z`).getTime();
}
