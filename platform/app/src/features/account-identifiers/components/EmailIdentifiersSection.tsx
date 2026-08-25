import {
  Badge,
  Box,
  Button,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SETTINGS_ACTION_BUTTON_WIDTH } from "~/components/settings/actionRow";
import { SectionErrorNotice } from "~/components/settings/SectionErrorNotice";
import { SettingsSectionRow } from "~/components/settings/SettingsSection";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { showErrorToast } from "~/features/errors";
import type { AccountIdentifier } from "~/server/app-layer/identity/account-identifiers.service";
import { api } from "~/utils/api";
import { useResendBackoff } from "../hooks/useResendBackoff";
import { lastUsedLabel } from "../logic/lastUsed";
import { useSearchParams } from "~/utils/compat/next-navigation";
import {
  forgetAddressVerifier,
  mintAddressCeremony,
  readAddressVerifier,
  rememberAddressVerifier,
} from "../logic/addressCeremony";
import { refusalCopy } from "../logic/refusalCopy";

/**
 * The addresses an account can be reached and recovered at, and the ways to
 * change that set.
 *
 * This is the door the detach guard's remediation copy has been pointing at
 * since the guard shipped: "add a verified email address first" was true
 * advice with nowhere to follow it. Adding one, confirming it, and giving one
 * up all live here, on the identity ceremonies rather than on a column.
 *
 * Two rules the surface never breaks.
 *
 * The first: Remove is stood down BEFORE the click where the guard would
 * refuse, and the reason on it is the guard's own registered words —
 * `refusalCode` comes down with the list from the same predicate the route
 * enforces. A button that is always going to fail is worse than no button,
 * and a reason invented by the screen is a second copy of the invariant.
 *
 * The second: an address is unconfirmed until the emailed ceremony completes,
 * and the screen says so plainly. Nothing about the account can be recovered
 * through an address nobody has proved, which is exactly why removing an
 * unconfirmed one is still allowed — it strands nobody.
 *
 * Spec: specs/identity/authentication-settings.feature
 */
export function EmailIdentifiersSection({
  providerRows,
  trailingActions,
}: {
  /** The linked-account rows, rendered under the addresses as one list: to a
   *  reader they are the same kind of thing, and to the detach guard they
   *  literally are. */
  providerRows?: ReactNode;
  /** What shares the band's ONE action row with "Add an email address". The
   *  band supplies it, because adding an address and connecting a provider are
   *  the same offer — another way to be known — and two rows of buttons said
   *  they were two subjects. */
  trailingActions?: ReactNode;
} = {}) {
  const utils = api.useUtils();
  const identifiers = api.identity.myIdentifiers.useQuery({});
  // The account's own address and whether it is confirmed — the same read the
  // app shell's nudge makes, so the two can never disagree about it.
  const confirmation = api.auth.myAddressConfirmation.useQuery();
  const resendOwnAddress =
    api.auth.sendMyAddressConfirmation.useMutation();
  const resendAdded = api.identity.resendIdentifierConfirmation.useMutation();
  // When each address last got somebody in. Answers the one question a list
  // of addresses otherwise cannot: which of these am I still relying on.
  const lastUsed = api.identity.myMethodsLastUsed.useQuery({});
  const addAddress = api.identity.addEmailIdentifier.useMutation();
  const removeIdentifier = api.identity.removeIdentifier.useMutation();

  const [resentTo, setResentTo] = useState<string | null>(null);
  const sentTo = resentTo;

  const rows = identifiers.data ?? [];
  const emailRows = rows.filter((row) => row.provider === "email");
  const ownAddress = confirmation.data?.email ?? null;

  const refresh = async () => {
    await Promise.all([
      utils.identity.myIdentifiers.invalidate(),
      utils.auth.myAddressConfirmation.invalidate(),
    ]);
  };

  const add = async (email: string): Promise<boolean> => {
    if (!email) return false;
    try {
      const { codeVerifier, codeChallenge } = await mintAddressCeremony();
      const { identifierId } = await addAddress.mutateAsync({
        email,
        codeChallenge,
      });
      rememberAddressVerifier({ identifierId, codeVerifier });
      setResentTo(email);
      await refresh();
      return true;
    } catch (error) {
      // Refused, so the field stays open holding what was typed: retyping an
      // address to correct one character is the worst possible answer to it.
      showErrorToast({ error, fallbackTitle: "Couldn't add that address" });
      return false;
    }
  };

  const resend = async (row: (typeof rows)[number]) => {
    try {
      if (row.value && row.value === ownAddress) {
        // Reuses the shell nudge's own mutation: one address, one sender.
        await resendOwnAddress.mutateAsync({});
      } else {
        const { codeVerifier, codeChallenge } = await mintAddressCeremony();
        await resendAdded.mutateAsync({
          identifierId: row.identifierId,
          codeChallenge,
        });
        rememberAddressVerifier({
          identifierId: row.identifierId,
          codeVerifier,
        });
      }
      setResentTo(row.value);
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't send that link" });
    }
  };

  const remove = async (row: (typeof rows)[number]) => {
    try {
      await removeIdentifier.mutateAsync({ identifierId: row.identifierId });
      forgetAddressVerifier({ identifierId: row.identifierId });
      toaster.success({ title: "Address removed" });
      await refresh();
    } catch (error) {
      // The guard's refusal, in the guard's registered words.
      showErrorToast({ error, fallbackTitle: "Couldn't remove that address" });
    }
  };

  return (
    <VStack
      width="full"
      align="stretch"
      gap={4}
      data-testid="email-identifiers-section"
    >
      <AddressConfirmationLanding onConfirmed={refresh} />

      {identifiers.isPending || confirmation.isPending ? (
        <Spinner size="sm" />
      ) : null}

      {/* The list is the identity heads and the row below is the shell's own
            read of one address, so a failed read still shows the address we
            can state — and says, in the words of the code it failed with, that
            the rest could not be loaded. A list that is quietly short is worse
            than a short list somebody was told about. */}
      <SectionErrorNotice
        error={identifiers.error}
        fallbackTitle="Couldn't load the addresses on this account"
      />

      {/* Addresses and providers as ONE list: to a reader they are the same
          kind of thing — a way this account is known — and to the detach guard
          they literally are, which is why the same refusal can come from
          either. */}
      <VStack width="full" align="stretch" gap={2}>
        {emailRows.length > 0 ? (
          emailRows.map((row) => (
            <AddressRow
              key={row.identifierId}
              row={row}
              linkJustSent={sentTo !== null && sentTo === row.value}
              lastUsedAt={
                lastUsed.data?.byIdentifier[row.identifierId] ?? null
              }
              isSending={resendAdded.isPending || resendOwnAddress.isPending}
              isRemoving={removeIdentifier.isPending}
              onResend={() => void resend(row)}
              onRemove={() => void remove(row)}
            />
          ))
        ) : ownAddress ? (
          // Before this account's identifiers exist, its one address is still
          // a fact worth stating — and the shell's own read is what states it.
          // Through the same row, so the two states of an account look alike.
          <AddressRow
            row={{
              identifierId: ownAddress,
              accountId: null,
              provider: "email",
              value: ownAddress,
              // The account's own address IS the primary one — it is the
              // address on `User.email`, the one sign-in finds and the one
              // every notification goes to. Hardcoding false here left the
              // Primary badge off the single row that always earns it, so
              // before an account had identifiers the section showed a list
              // of addresses with nothing marking which one the account
              // actually answers to.
              isPrimary: true,
              confirmed: confirmation.data?.confirmed === true,
              resendable: confirmation.data?.confirmed === false,
              removable: false,
              refusalCode: null,
              demotesFirst: false,
            }}
            linkJustSent={sentTo !== null && sentTo === ownAddress}
            lastUsedAt={null}
            isSending={resendOwnAddress.isPending}
            isRemoving={false}
            onResend={() => {
              resendOwnAddress.mutate(
                {},
                {
                  onSuccess: () => setResentTo(ownAddress),
                  onError: (error) =>
                    showErrorToast({
                      error,
                      fallbackTitle: "Couldn't send that link",
                    }),
                },
              );
            }}
            onRemove={() => void 0}
            hideRemove
          />
        ) : null}

        {providerRows}
      </VStack>

      {/* ONE action row for the whole band. Offered whatever the list did:
          standing a control down because a neighbouring read failed hides a
          working action behind a broken one, and if the add is refused too it
          says so in its own words. */}
      {/* Ranged RIGHT, under the rows they act on. The addresses above are a
          list of things that exist; these are the ways to add another, and a
          left-ranged action row read as one more list item with a border
          around it. Against the right edge they read as controls for the band
          rather than as another member of it — and the edge they align to is
          the one the rows' own actions ("Send the link again") already sit
          on, so the card has one action column instead of two. */}
      <HStack
        width="full"
        gap={3}
        flexWrap="wrap"
        align="center"
        justify="flex-end"
      >
        <AddAddressControl onAdd={add} isSending={addAddress.isPending} />
        {trailingActions ? (
          <>
            {/* Two families on one row: what this account is reached at, and
                who vouches for it. The rule disappears where the row wraps —
                a hairline dangling at a line break reads as a mistake. */}
            <Box
              display={{ base: "none", md: "block" }}
              width="1px"
              height="20px"
              backgroundColor="border.muted"
              flexShrink={0}
              aria-hidden="true"
            />
            {trailingActions}
          </>
        ) : null}
      </HStack>
    </VStack>
  );
}

/**
 * Adding one: a single button until it is pressed, then the field and the two
 * answers to it.
 *
 * It holds the half-typed address itself. The section around it re-renders on
 * every read that lands, and a draft living up there is a draft that can be
 * cleared by something the person did not do.
 */
function AddAddressControl({
  onAdd,
  isSending,
}: {
  /** Resolves true when the address was accepted and the field can close. */
  onAdd: (email: string) => Promise<boolean>;
  isSending: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [address, setAddress] = useState("");

  const close = () => {
    setIsOpen(false);
    setAddress("");
  };

  const submit = async () => {
    const accepted = await onAdd(address.trim());
    if (accepted) close();
  };

  if (!isOpen) {
    return (
      <Box>
        <Button
          size="sm"
          variant="outline"
          width={SETTINGS_ACTION_BUTTON_WIDTH}
          justifyContent="center"
          onClick={() => setIsOpen(true)}
          data-testid="add-address"
        >
          <Plus size={14} />
          Add email address
        </Button>
      </Box>
    );
  }

  return (
    <HStack width="full" gap={2}>
      <Input
        size="sm"
        type="email"
        placeholder="you@company.com"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        data-testid="new-address"
      />
      <Button
        size="sm"
        colorPalette="orange"
        loading={isSending}
        disabled={!address.trim()}
        onClick={() => void submit()}
        data-testid="confirm-add-address"
      >
        Send confirmation
      </Button>
      <Button size="sm" variant="ghost" onClick={close}>
        Cancel
      </Button>
    </HStack>
  );
}

/**
 * One address: what it is, whether it has been confirmed, and the two things
 * that can be done to it.
 *
 * The account's own address renders through this too, from the shell's read
 * rather than from an identifier, so the pre-identity state of an account
 * looks exactly like the state after it — one row treatment, not two.
 */
function AddressRow({
  row,
  linkJustSent,
  lastUsedAt,
  isSending,
  isRemoving,
  onResend,
  onRemove,
  hideRemove = false,
}: {
  row: AccountIdentifier;
  /** The confirmation went out just now, and the row should say so. */
  linkJustSent: boolean;
  /** When this address last minted a session, where we still hold one. */
  lastUsedAt: string | null;
  isSending: boolean;
  isRemoving: boolean;
  onResend: () => void;
  onRemove: () => void;
  /** For the row that stands in before identifiers exist: there is nothing to
   *  detach yet, so there is nothing honest to offer. */
  hideRemove?: boolean;
}) {
  // Per ROW, not per section: two unconfirmed addresses are two separate
  // conversations, and pressing one should not stand the other down.
  const backoff = useResendBackoff();

  return (
    <SettingsSectionRow testId="email-identifier-row">
      <VStack align="start" gap={0} minWidth={0}>
        <HStack gap={2}>
          <Text fontSize="sm" fontWeight={500}>
            {row.value}
          </Text>
          {row.isPrimary ? (
            <Badge size="sm" variant="subtle">
              Primary
            </Badge>
          ) : null}
          {row.confirmed ? (
            <Badge
              size="sm"
              colorPalette="green"
              variant="subtle"
              data-testid="address-confirmed"
            >
              Confirmed
            </Badge>
          ) : (
            <Badge
              size="sm"
              colorPalette="orange"
              variant="subtle"
              data-testid="address-unconfirmed"
            >
              Not confirmed yet
            </Badge>
          )}
        </HStack>
        <AddressRowNote
          row={row}
          linkJustSent={linkJustSent}
          lastUsedAt={lastUsedAt}
        />
      </VStack>
      <Spacer />
      {row.resendable ? (
        <Button
          size="xs"
          variant="outline"
          loading={isSending}
          // The wait is a real refusal, so the button carries it rather than
          // taking a press it means to drop.
          disabled={backoff.isWaiting}
          onClick={() => {
            backoff.recordAttempt();
            onResend();
          }}
          data-testid="resend-address-link"
        >
          {backoff.secondsToWait === null
            ? "Send the link again"
            : `Send it again in ${backoff.secondsToWait}s`}
        </Button>
      ) : null}
      {hideRemove ? null : (
        <RemoveAddressButton
          refusalCode={row.refusalCode}
          removable={row.removable}
          isPending={isRemoving}
          onRemove={onRemove}
        />
      )}
    </SettingsSectionRow>
  );
}

/**
 * The one line under an address, when there is one worth saying.
 *
 * A link that has just gone out beats everything else: a button that reads the
 * same after a click as before it is a button nobody can tell worked.
 */
function AddressRowNote({
  row,
  linkJustSent,
  lastUsedAt,
}: {
  row: AccountIdentifier;
  linkJustSent: boolean;
  lastUsedAt: string | null;
}) {
  if (linkJustSent) {
    return (
      <Text fontSize="xs" color="fg.muted" data-testid="address-link-sent">
        Check your email — we sent a link to {row.value}. Open it in this
        browser to finish.
      </Text>
    );
  }
  if (row.demotesFirst && row.removable) {
    return (
      <Text fontSize="xs" color="fg.muted">
        Removing this makes another confirmed address primary first.
      </Text>
    );
  }
  // Last, because the notes above are about something that needs doing and
  // this is only ever context. Absent for an address we hold no session for,
  // and silent rather than "never used" — see `lastUsedLabel`.
  const used = lastUsedLabel(lastUsedAt);
  if (used) {
    return (
      <Text fontSize="xs" color="fg.muted" data-testid="address-last-used">
        {used}
      </Text>
    );
  }
  return null;
}

/**
 * Remove, and the guard's reason when it is not offered.
 *
 * A disabled button with no explanation is the worst version of this: the
 * person can see the thing they want and is told nothing about why they
 * cannot have it. The tooltip carries the registry's words for the code the
 * route would refuse with, so the screen and the refusal say the same thing.
 */
function RemoveAddressButton({
  refusalCode,
  removable,
  isPending,
  onRemove,
}: {
  refusalCode: string | null;
  removable: boolean;
  isPending: boolean;
  onRemove: () => void;
}) {
  const button = (
    <Button
      size="xs"
      variant="ghost"
      colorPalette="red"
      disabled={!removable || isPending}
      onClick={onRemove}
      data-testid="remove-address"
    >
      Remove
    </Button>
  );

  if (removable || !refusalCode) return button;

  return (
    <Tooltip content={refusalCopy(refusalCode)} showArrow>
      {/* The trigger has to be something that still receives pointer events,
          which a disabled button does not — so the wrapper is the trigger. */}
      <Box data-testid="remove-address-blocked">{button}</Box>
    </Tooltip>
  );
}

/**
 * The other half of the ceremony: the emailed link landing back here.
 *
 * Completion needs the token from the link AND the verifier this browser kept
 * when it started. A link opened somewhere else carries only the first, and
 * this says so rather than failing — which is the whole security property,
 * stated as words instead of as an error.
 */
function AddressConfirmationLanding({
  onConfirmed,
}: {
  onConfirmed: () => Promise<void>;
}) {
  const query = useSearchParams();
  const identifierId = query?.get("confirm") ?? null;
  const verificationId = query?.get("verification") ?? null;
  const token = query?.get("token") ?? null;
  const complete = api.identity.completeVerification.useMutation();
  const [outcome, setOutcome] = useState<"confirmed" | "wrong-browser" | null>(
    null,
  );
  // The link is single-use: a second attempt would fail on a link that worked.
  const spent = useRef(false);

  useEffect(() => {
    if (!identifierId || !verificationId || !token || spent.current) return;
    spent.current = true;

    const codeVerifier = readAddressVerifier({ identifierId });
    if (!codeVerifier) {
      setOutcome("wrong-browser");
      return;
    }

    complete
      .mutateAsync({ identifierId, verificationId, token, codeVerifier })
      .then(async () => {
        forgetAddressVerifier({ identifierId });
        setOutcome("confirmed");
        await onConfirmed();
      })
      .catch((error: unknown) => {
        showErrorToast({
          error,
          fallbackTitle: "Couldn't confirm that address",
        });
      });
  }, [identifierId, verificationId, token, complete, onConfirmed]);

  if (outcome === "confirmed") {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="address-confirmed-now">
        That address is confirmed. You can sign in with it, and we can reach you
        at it.
      </Text>
    );
  }

  if (outcome === "wrong-browser") {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="address-wrong-browser">
        Open the link in the window you added the address from. A link on its
        own confirms nothing, which is what stops a forwarded one working.
      </Text>
    );
  }

  return null;
}
