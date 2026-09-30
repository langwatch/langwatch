import {
  Button,
  HStack,
  Input,
  NativeSelect,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { SsoSettingsTable } from "@ee/sso/components/SsoSettingsTable";
import {
  endOfLocalDay,
  localIsoDateInDays,
} from "@ee/sso/logic/breakGlassDates";
import type { SelfServeBreakGlassBindingView } from "@ee/sso/sso-self-serve.types";
import { BREAK_GLASS_MAX_WINDOW_DAYS } from "@langwatch/identity";
import { useState } from "react";
import { CopyValueRows } from "~/components/settings/CopyValueRows";
import { SettingsRowsSkeleton } from "~/components/settings/kit/SettingsSkeleton";
import { api } from "~/utils/api";
import { PendingSetupChange } from "./pending-setup-change";
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
  const [grantAcceptedFromCount, setGrantAcceptedFromCount] = useState<
    number | null
  >(null);

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

      <LiveGrants
        error={bindings.error}
        isLoading={bindings.isLoading}
        live={live}
        organizationId={organizationId}
        canManage={canManage}
        endsOn={endsOn}
        onSettled={refresh}
      />

      {grantAcceptedFromCount !== null && (
        <PendingSetupChange
          organizationId={organizationId}
          isSettled={(setup) =>
            (setup.goLive?.breakGlass.liveCount ?? 0) > grantAcceptedFromCount
          }
          onSettled={() => setGrantAcceptedFromCount(null)}
        >
          Recovery access is being updated. This section will refresh when the
          new way back in is available.
        </PendingSetupChange>
      )}

      {live.length > 0 && <WhereTheyGetIn />}

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
                  {
                    organizationId,
                    userId,
                    expiresAtMs: endOfLocalDay(endsOn),
                  },
                  {
                    onSuccess: () => {
                      setUserId("");
                      setGrantAcceptedFromCount(live.length);
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

/**
 * The grants that are live, or the reason there are none to show.
 *
 * Its own component because the four-armed branch is the whole of this
 * section's shape and the section has other work to do: leaving it inline put
 * the parent over the complexity the house allows the moment anything else
 * was added beside it.
 */
function LiveGrants({
  error,
  isLoading,
  live,
  organizationId,
  canManage,
  endsOn,
  onSettled,
}: {
  error: unknown;
  isLoading: boolean;
  live: SelfServeBreakGlassBindingView[];
  organizationId: string;
  canManage: boolean;
  endsOn: string;
  onSettled: () => void;
}) {
  if (error) return <LoadFailure error={error} what="the ways back in" />;
  // The table's own shape while its data lands: one grant is what the section
  // usually holds, so one placeholder row is what it draws.
  if (isLoading) return <SettingsRowsSkeleton rows={1} showLead={false} />;
  if (live.length === 0) {
    return (
      <Text color="fg.muted" fontSize="sm">
        Nobody can get in without your identity provider yet.
      </Text>
    );
  }
  // Literally the same frame the domains table two steps up wears, so the two
  // read as one screen rather than two.
  return (
    <SsoSettingsTable>
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
            onSettled={onSettled}
          />
        ))}
      </Table.Body>
    </SsoSettingsTable>
  );
}

/**
 * The address a grant is actually spent at.
 *
 * A WAY BACK IN NOBODY CAN FIND IS NOT A WAY BACK IN. Once the connection is
 * live the front door hands every visitor to the identity provider, and the
 * password form survives at exactly one address — `/auth/signin?local=1`.
 * That parameter appeared in code comments and two `.feature` files and in no
 * rendered copy anywhere, so the screen asked an administrator to name
 * somebody who could still get in and then never told either of them how.
 *
 * Shown only once a grant exists, because until then there is nobody to send
 * it to, and drawn as a value to carry elsewhere because that is what it is:
 * the holder is not reading this screen, so it has to travel.
 */
function WhereTheyGetIn() {
  return (
    <VStack align="stretch" gap={2}>
      <Text color="fg.muted" fontSize="sm">
        Send this address to whoever you named. The ordinary sign-in page hands
        everyone to your identity provider, so this is the one that still asks
        for a password. It is not linked from anywhere else, by design.
      </Text>
      <CopyValueRows
        rows={[
          {
            label: "Where they sign in",
            hint: "Works even while single sign-on is on",
            value: `${window.location.origin}/auth/signin?local=1`,
          },
        ]}
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
  candidates: Array<{
    userId: string;
    name: string | null;
    email: string | null;
    holdsPassword?: boolean;
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
            <option
              key={person.userId}
              value={person.userId}
              disabled={person.holdsPassword === false}
            >
              {person.name ?? person.email ?? person.userId}
              {person.holdsPassword === false ? " (set a password first)" : ""}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {/* Bounded to the window the server enforces, so the picker cannot
          offer a date that is going to be refused. The refusal stays as the
          backstop — a date typed rather than picked still reaches it. */}
      <Input
        type="date"
        value={endsOn}
        aria-label="Until"
        min={localIsoDateInDays(1)}
        max={localIsoDateInDays(BREAK_GLASS_LAST_OFFERED_DAYS)}
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
          {/* The month in words. `toLocaleDateString()`'s numeric default is
              read as day-first by half the world and month-first by the
              other half, and this table sits directly under a date input
              that renders in the BROWSER's locale — so the two could
              disagree about which number was the month while both were
              "correct". A spelled month cannot be misread either way. */}
          <Text>
            {new Date(binding.expiresAtMs).toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </Text>
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
                    expiresAtMs: endOfLocalDay(endsOn),
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
 * Thirty days, not the ninety the window allows. A default should be the
 * answer somebody would have picked, and the longest permitted grant is not
 * that: it is the most dangerous one the rules still allow. A way back in
 * that outlives the incident it was opened for is the thing this whole
 * section exists to prevent, and anybody who genuinely needs a quarter can
 * say so in the field.
 *
 * It was ninety, which was also exactly the maximum — and `endOfDay` then
 * rounded that UP to the last millisecond of the day, landing past
 * `now + 90 days` by however long the day had left. So the default was not
 * merely long, it was out of range: every grant taken at face value was
 * refused with `sso_break_glass_expiry_out_of_range`, and the button could
 * not be used at all without editing the date first.
 */
const BREAK_GLASS_DEFAULT_DAYS = 30;

/**
 * The furthest date the picker offers.
 *
 * A day inside the window rather than on it, for the rounding reason above:
 * the end of `today + 89` is always before `now + 90 days`, whatever time of
 * day it is now, while the end of `today + 90` never is. The server still
 * refuses anything out of range — this only stops the screen from offering a
 * date it knows will be refused.
 */
const BREAK_GLASS_LAST_OFFERED_DAYS = BREAK_GLASS_MAX_WINDOW_DAYS - 1;

/**
 * Where the picker starts, when nobody has moved it.
 *
 * The date arithmetic itself — and the timezone care it needs — lives in
 * `@ee/sso/logic/breakGlassDates`, because a local calendar date
 * turned into an instant through UTC is what used to put this table a day
 * ahead of the picker above it.
 */
function defaultEndDate(): string {
  return localIsoDateInDays(BREAK_GLASS_DEFAULT_DAYS);
}
