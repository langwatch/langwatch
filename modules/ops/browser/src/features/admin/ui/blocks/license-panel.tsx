import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { useState } from "react";

import { useOpsToaster } from "../../../../behavior/ops-feedback.ts";
import {
  useLicenseChanges,
  type ReplacementChange,
  type SignedKey,
} from "../../behavior/use-license-changes.ts";
import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import { formatDay, type LicenseChainState } from "../../model/license-chain.ts";
import { SERVICE_LABELS, type License } from "../../model/license-terms.ts";
import { seatChangeSummary } from "../../model/seat-change-summary.ts";
import { Panel, TermRow } from "../elements/drawer-sections.tsx";
import { SignedLicenseOnce } from "../elements/signed-license-once.tsx";
import { LicenseExtendForm } from "./license-extend-form.tsx";
import { LicenseHistory } from "./license-history.tsx";
import { LicenseSeatsForm, type SeatsChange } from "./license-seats-form.tsx";

export type LicensePart = "extend" | "seats" | "terms" | "history" | null;

/** A key signed in the drawer: shown at once when no install is bound, else behind a link. */

export type SignReplacement = (input: {
  change: ReplacementChange;
  failureTitle: string;
}) => Promise<SignedKey | null>;

function liteSeatsText(license: License): string {
  if (license.liteSeatsUnlimited) return "unlimited lite";
  return license.maxMembersLite === null ? "lite not stated" : `${license.maxMembersLite} lite`;
}

function seatsText(license: License): string {
  return `${license.maxMembers} full · ${liteSeatsText(license)} · ${license.maxMembersDeveloper ?? 0} Developer`;
}

function serviceLabel(service: string): string {
  return Object.entries(SERVICE_LABELS).find(([key]) => key === service)?.[1] ?? service;
}

function WaitingForSync() {
  return (
    <Badge colorPalette="orange" size="sm">
      waiting for sync
    </Badge>
  );
}

function Moving({ text }: { text: string }) {
  return (
    <HStack gap={2} wrap="wrap">
      <Text>{text}</Text>
      <WaitingForSync />
    </HStack>
  );
}

function TermValue({ chain }: { chain: LicenseChainState }) {
  const { head, inUse, pending } = chain;
  const from = `${formatDay(inUse.issuedAt)} to ${formatDay(inUse.expiresAt)}`;
  if (pending && pending.expiresAt !== inUse.expiresAt) {
    return <Moving text={`${from} → ${formatDay(pending.expiresAt)}`} />;
  }
  return <Text>{`${formatDay(inUse.issuedAt)} to ${formatDay(head.expiresAt)}`}</Text>;
}

const developerSeats = (license: License): number => license.maxMembersDeveloper ?? 0;

/** The seat counts a waiting replacement moves, as "25 → 30 full · 0 → 5 Developer". */
function seatMoves({ from, to }: { from: License; to: License }): string[] {
  return [
    ...(to.maxMembers === from.maxMembers ? [] : [`${from.maxMembers} → ${to.maxMembers} full`]),
    ...(developerSeats(to) === developerSeats(from)
      ? []
      : [`${developerSeats(from)} → ${developerSeats(to)} Developer`]),
  ];
}

function SeatsValue({ chain }: { chain: LicenseChainState }) {
  const { head, inUse, pending } = chain;
  const moves = pending ? seatMoves({ from: inUse, to: pending }) : [];
  if (moves.length > 0) return <Moving text={moves.join(" · ")} />;
  return <Text>{seatsText(head)}</Text>;
}

function ServiceBadges({ services }: { services: string[] }) {
  if (services.length === 0) return <Text color="fg.muted">None</Text>;
  return (
    <HStack gap={1} wrap="wrap">
      {services.map((service) => (
        <Badge key={service} colorPalette="gray">
          {serviceLabel(service)}
        </Badge>
      ))}
    </HStack>
  );
}

/** The key a change signed: for the customer to paste, or for an install that cannot sync. */
function SignedKeyNote({ signed }: { signed: SignedKey | null }) {
  const [showKey, setShowKey] = useState(false);
  if (!signed) return null;
  if (signed.forCustomer) {
    return (
      <VStack align="stretch" gap={2} data-testid="send-key">
        <Text fontWeight="medium" fontSize="sm">
          Send this key to the customer
        </Text>
        <Text fontSize="sm" color="fg.muted">
          Their admin pastes it in Settings, License, Add license. It binds on its first sync and
          every later change arrives by itself.
        </Text>
        <SignedLicenseOnce licenseKey={signed.licenseKey} />
      </VStack>
    );
  }
  if (showKey) return <SignedLicenseOnce licenseKey={signed.licenseKey} />;
  return (
    <Button size="xs" variant="plain" alignSelf="start" onClick={() => setShowKey(true)}>
      Install can't sync? Show the signed key
    </Button>
  );
}

/** A replaced key no install used that still works, read from the chain, and its End action. */
function UnusedKeyLeft({ chain }: { chain: LicenseChainState }) {
  const { endUnusedKeys } = useLicenseChanges();
  const [ending, setEnding] = useState(false);
  if (chain.leftover.length === 0) return null;
  const end = async () => {
    setEnding(true);
    await endUnusedKeys({ ids: chain.leftover.map((license) => license.id) });
    setEnding(false);
  };
  return (
    <HStack gap={2} wrap="wrap" data-testid="unused-key-left">
      <Text fontSize="sm" color="fg.muted">
        The unused key still works.
      </Text>
      <Button size="xs" variant="outline" loading={ending} onClick={() => void end()}>
        End the unused key
      </Button>
    </HStack>
  );
}

function HistoryToggle({
  chain,
  open,
  onOpen,
}: {
  chain: LicenseChainState;
  open: boolean;
  onOpen: () => void;
}) {
  if (chain.licenses.length < 2) return null;
  if (open) return <LicenseHistory chain={chain} />;
  return (
    <Button size="xs" variant="plain" alignSelf="start" onClick={onOpen}>
      {`License history (${chain.licenses.length})`}
    </Button>
  );
}

/** What an extension leaves to do, as the toast says it. */
function extendedNote({ signed, install }: { signed: SignedKey; install: string | null }): string {
  if (!signed.forCustomer) {
    return `${install ?? "The install"} picks it up on its next sync. Nothing to send.`;
  }
  return signed.unusedKeyLeft
    ? "Send the new key to the customer. The unused key still works: end it below."
    : "Send the new key to the customer. The unused one no longer works.";
}

/** Extend term and Change seats, each a replacement of the chain's newest license. */
function usePanelChanges({
  chain,
  onSign,
  onDone,
  onSeatsChanged,
}: {
  chain: LicenseChainState;
  onSign: SignReplacement;
  onDone: () => void;
  onSeatsChanged: (signed: SignedKey) => void;
}) {
  const commands = useLicenseCommands();
  const { afterSigning } = useLicenseChanges();
  const toaster = useOpsToaster();
  const [seatSummary, setSeatSummary] = useState<string | null>(null);
  const install = chain.unbound ? null : chain.inUse.instanceId;

  const extend = async (expiresAt: string) => {
    const signed = await onSign({
      change: { expiresAt },
      failureTitle: "The license was not extended",
    });
    if (!signed) return;
    onDone();
    toaster.create({
      title: `Term extended to ${formatDay(expiresAt)}`,
      description: extendedNote({ signed, install }),
      type: "success",
      duration: 5000,
    });
  };

  const changeDevelopers = async (maxMembersDeveloper: number) => {
    const done = await onSign({
      change: { expiresAt: chain.head.expiresAt, maxMembersDeveloper },
      failureTitle: "The seats were not changed",
    });
    if (!done) return;
    onDone();
    setSeatSummary(`Developer seats changed to ${maxMembersDeveloper}.`);
  };

  const changeSeats = (change: SeatsChange) => {
    if (change.kind === "developer") {
      void changeDevelopers(change.maxMembersDeveloper);
      return;
    }
    commands.changeSeats.mutate(
      { id: chain.head.id, maxMembers: change.maxMembers },
      {
        onSuccess: (result) => {
          onDone();
          setSeatSummary(seatChangeSummary(result));
          void afterSigning({ chain, licenseKey: result.licenseKey }).then(onSeatsChanged);
        },
      },
    );
  };

  return {
    install,
    extend,
    changeSeats,
    seatSummary,
    isChangingSeats: commands.changeSeats.isPending,
  };
}

/** What the install gets: plan, term, seats and hosted services, each with its own change. */
export function LicensePanel({
  chain,
  isTrial,
  part,
  onPart,
  signed,
  isSigning,
  onSign,
  onSeatsChanged,
}: {
  chain: LicenseChainState;
  isTrial: boolean;
  part: LicensePart;
  onPart: (part: LicensePart) => void;
  signed: SignedKey | null;
  isSigning: boolean;
  onSign: SignReplacement;
  onSeatsChanged: (signed: SignedKey) => void;
}) {
  const { head, inUse } = chain;
  const changes = usePanelChanges({ chain, onSign, onDone: () => onPart(null), onSeatsChanged });
  const toggle = (next: LicensePart) => onPart(part === next ? null : next);
  const canExtend = head.status === "active" || head.status === "expired";

  return (
    <Panel
      title="License"
      summary="What the install gets"
      highlighted={part === "extend" || part === "seats"}
      data-testid="license-panel"
    >
      <TermRow label="Plan">{isTrial ? `${head.planType}, trial` : head.planType}</TermRow>
      <TermRow
        label="Term"
        action={
          canExtend ? (
            <Button size="xs" variant="outline" onClick={() => toggle("extend")}>
              Extend term
            </Button>
          ) : undefined
        }
      >
        <TermValue chain={chain} />
      </TermRow>
      {part === "extend" ? (
        <LicenseExtendForm
          expiresAt={head.expiresAt}
          inUseEndsAt={inUse.expiresAt}
          install={changes.install}
          isSaving={isSigning}
          onCancel={() => onPart(null)}
          onExtend={(expiresAt) => void changes.extend(expiresAt)}
        />
      ) : null}
      <TermRow
        label="Seats"
        action={
          head.status === "active" ? (
            <Button size="xs" variant="outline" onClick={() => toggle("seats")}>
              Change seats
            </Button>
          ) : undefined
        }
      >
        <SeatsValue chain={chain} />
      </TermRow>
      {part === "seats" ? (
        <LicenseSeatsForm
          license={head}
          inUse={inUse.lastSyncAt ? (inUse.reportedMembers ?? 0) : null}
          install={changes.install}
          isSaving={isSigning || changes.isChangingSeats}
          onCancel={() => onPart(null)}
          onChange={changes.changeSeats}
        />
      ) : null}
      {changes.seatSummary ? (
        <Text fontSize="sm" data-testid="change-seats-result">
          {changes.seatSummary}
        </Text>
      ) : null}
      <TermRow
        label="Hosted services"
        action={
          <Button size="xs" variant="outline" onClick={() => onPart("terms")}>
            Edit
          </Button>
        }
      >
        <ServiceBadges services={head.services} />
      </TermRow>
      <SignedKeyNote signed={signed} />
      <UnusedKeyLeft chain={chain} />
      <Text fontSize="xs" color="fg.muted">
        {changes.install
          ? "Changes here reach the install on its next daily sync. Nothing to send."
          : "Not activated: a change here signs a new key, and you send that key again."}
      </Text>
      <HistoryToggle chain={chain} open={part === "history"} onOpen={() => onPart("history")} />
    </Panel>
  );
}
