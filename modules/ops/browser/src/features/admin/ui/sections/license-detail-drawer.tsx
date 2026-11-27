import { Lent } from "@langwatch/browser-host/lent";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  Alert,
  Badge,
  Button,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { LicenseBillingSectionToken } from "@langwatch/enterprise-billing-client";
import { nowEpochMs } from "@langwatch/time";
import { useMemo, useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import {
  useLicenseChanges,
  type ReplacementChange,
  type SignedKey,
} from "../../behavior/use-license-changes.ts";
import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import {
  formatDay,
  licenseChainState,
  recentlyApplied,
  type LicenseChainState,
} from "../../model/license-chain.ts";
import {
  centsToDollars,
  termsFormFrom,
  type License,
  type TermsForm,
} from "../../model/license-terms.ts";
import { LicenseDeliveryBanner, LicenseInstallStatus } from "../blocks/license-install-status.tsx";
import { LicensePanel, type LicensePart } from "../blocks/license-panel.tsx";
import { LicenseTermsFields } from "../blocks/license-terms-fields.tsx";
import { formatDateTime } from "../elements/admin-cells.tsx";
import { Panel } from "../elements/drawer-sections.tsx";
import { LicenseStatusBadge } from "../elements/license-status-badge.tsx";

/** Whether the customer pays for the license: billing says so once its section loads. */
type BillingState = "trial" | "billed";

type Revoke = (license: License) => void;

/**
 * One customer's license in the Ops console (ADR-156): the install that holds
 * it, what it gets, and billing only once the customer pays. The drawer reads
 * the whole reissue chain, so a replacement waiting for sync shows in place.
 */
export function LicenseDetailDrawer({
  licenseId,
  onClose,
  onRevoke,
}: {
  licenseId: string | null;
  onClose: () => void;
  /** Opens the revoke on the license in use; the dialog reaches every live license of its chain. */
  onRevoke: Revoke;
}) {
  const query = api.licenseRegistry.getChain.useQuery(
    { id: licenseId ?? "" },
    { enabled: licenseId !== null, retry: false },
  );
  const chain = useMemo(
    () => (query.data ? licenseChainState({ licenses: query.data.licenses }) : null),
    [query.data],
  );
  const [billing, setBilling] = useState<{ licenseId: string; state: BillingState } | null>(null);
  const billingState = billing && billing.licenseId === licenseId ? billing.state : null;
  const failed = !query.isLoading && !chain && licenseId !== null;

  return (
    <Drawer
      open={licenseId !== null}
      onClose={onClose}
      title={chain ? chain.head.organizationName : "License"}
      badges={chain ? <ChainBadges chain={chain} billing={billingState} /> : undefined}
      size="lg"
      loading={query.isLoading}
      error={failed ? { title: "Couldn't load this license." } : undefined}
    >
      {chain && licenseId ? (
        <DrawerBody
          key={licenseId}
          chain={chain}
          billing={billingState}
          onBillingState={(state) =>
            setBilling((known) =>
              known?.licenseId === licenseId && known.state === state
                ? known
                : { licenseId, state },
            )
          }
          onRevoke={onRevoke}
        />
      ) : null}
    </Drawer>
  );
}

function ChainBadges({
  chain,
  billing,
}: {
  chain: LicenseChainState;
  billing: BillingState | null;
}) {
  const { head } = chain;
  if (head.status !== "active") return <LicenseStatusBadge status={head.status} />;
  if (chain.unbound) return <Badge colorPalette="gray">Not activated</Badge>;
  if (billing === "billed") return <Badge colorPalette="green">Paid</Badge>;
  if (billing === "trial") return <Badge colorPalette="yellow">Trial, not billed</Badge>;
  return <LicenseStatusBadge status={head.status} />;
}

function DrawerBody({
  chain,
  billing,
  onBillingState,
  onRevoke,
}: {
  chain: LicenseChainState;
  billing: BillingState | null;
  onBillingState: (state: BillingState) => void;
  onRevoke: Revoke;
}) {
  const [part, setPart] = useState<LicensePart>(null);
  // The signed key is stored nowhere; only another license clears it (the body is keyed by id).
  const [signed, setSigned] = useState<SignedKey | null>(null);
  const [seatChanges, setSeatChanges] = useState(0);
  const changes = useLicenseChanges();
  const [nowMs] = useState(nowEpochMs);
  const { head } = chain;

  const signReplacement = async ({
    change,
    failureTitle,
  }: {
    change: ReplacementChange;
    failureTitle: string;
  }) => {
    const signed = await changes.signReplacement({ chain, change, failureTitle });
    if (signed) setSigned(signed);
    return signed;
  };

  return (
    <VStack align="stretch" gap={4} width="full">
      <LicenseInstallStatus chain={chain} nowMs={nowMs} />
      <LicenseDeliveryBanner chain={chain} nowMs={nowMs} />
      <AppliedBanner chain={chain} nowMs={nowMs} />
      <LicensePanel
        chain={chain}
        isTrial={billing === "trial"}
        part={part}
        onPart={setPart}
        signed={signed}
        isSigning={changes.isSigning}
        onSign={signReplacement}
        onSeatsChanged={(signed) => {
          setSigned(signed);
          setSeatChanges((count) => count + 1);
        }}
      />
      {chain.unbound && !signed && head.status === "active" ? (
        <SendKeyPanel
          chain={chain}
          isSigning={changes.isSigning}
          onSignNewKey={() =>
            void signReplacement({
              change: { expiresAt: head.expiresAt },
              failureTitle: "No new key was signed",
            })
          }
        />
      ) : null}
      {head.organizationId ? null : <LinkOrganizationPanel license={head} />}
      <UsagePanel
        chain={chain}
        open={part === "terms"}
        onToggle={() => setPart(part === "terms" ? null : "terms")}
      />
      {head.organizationId ? (
        <Lent
          key={seatChanges}
          of={LicenseBillingSectionToken}
          props={{
            organizationId: head.organizationId,
            organizationName: head.organizationName,
            email: head.email,
            issuedAt: chain.inUse.issuedAt,
            expiresAt: head.expiresAt,
            maxMembers: head.maxMembers,
            seatRateCents: head.seatRateCents,
            seatCurrency: head.seatCurrency,
            commitUsdCents: head.commitUsdCents,
            onBillingState,
            signPaidTerm: async ({ expiresAt }) =>
              (await signReplacement({
                change: { expiresAt },
                failureTitle: "The license was not signed for the paid term",
              })) !== null,
          }}
        />
      ) : null}
      <DangerZone chain={chain} onRevoke={onRevoke} />
    </VStack>
  );
}

function AppliedBanner({ chain, nowMs }: { chain: LicenseChainState; nowMs: number }) {
  const applied = recentlyApplied({ chain, nowMs });
  if (!applied || !chain.head.instanceId) return null;
  return (
    <Alert.Root status="success" data-testid="license-applied-banner">
      <Alert.Indicator />
      <Alert.Content gap={1}>
        <Alert.Title>
          {`${chain.head.instanceId} applied the new license on ${formatDateTime(applied.appliedAt)}`}
        </Alert.Title>
        <Alert.Description>
          {`The term now ends ${formatDay(chain.head.expiresAt)}. The ${formatDay(applied.replaced.expiresAt)} license is retired.`}
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

function SendKeyPanel({
  chain,
  isSigning,
  onSignNewKey,
}: {
  chain: LicenseChainState;
  isSigning: boolean;
  onSignNewKey: () => void;
}) {
  return (
    <Panel
      title="Send the key"
      summary={`Shown once on ${formatDay(chain.head.issuedAt)}, not stored`}
      data-testid="send-key-panel"
    >
      <Text fontSize="sm" color="fg.muted">
        No install has used this license yet. If the customer lost the key, sign a new one. The
        unused key stops working at once.
      </Text>
      <Button
        size="xs"
        variant="outline"
        alignSelf="start"
        loading={isSigning}
        onClick={onSignNewKey}
      >
        Sign a new key
      </Button>
    </Panel>
  );
}

function LinkOrganizationPanel({ license }: { license: License }) {
  const commands = useLicenseCommands();
  const [organizationId, setOrganizationId] = useState("");
  return (
    <Panel title="Customer organization" summary="Not linked to a customer organization">
      <Text fontSize="sm" color="fg.muted">
        Until it is linked, this license resolves to no customer and cannot use hosted services.
      </Text>
      <HStack width="full">
        <Input
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
          placeholder="Organization id"
        />
        <Button
          size="sm"
          disabled={organizationId.trim() === ""}
          loading={commands.linkToOrganization.isPending}
          onClick={() =>
            commands.linkToOrganization.mutate({
              id: license.id,
              organizationId: organizationId.trim(),
            })
          }
        >
          Link
        </Button>
      </HStack>
    </Panel>
  );
}

function usageSummary(license: License): string {
  const commit = `Commit ${centsToDollars(license.commitUsdCents)} USD`;
  const overage = license.overageEnabled
    ? `overage up to ${centsToDollars(license.overageMaxUsdCents ?? 0)} USD`
    : "overage off";
  const rate =
    license.seatRateCents === null
      ? "no seat rate"
      : `seat rate ${centsToDollars(license.seatRateCents)} ${license.seatCurrency ?? "USD"}`;
  return [commit, overage, rate].join(" · ");
}

function UsagePanel({
  chain,
  open,
  onToggle,
}: {
  chain: LicenseChainState;
  open: boolean;
  onToggle: () => void;
}) {
  const changes = useLicenseChanges();
  const [form, setForm] = useState<TermsForm>(() => termsFormFrom(chain.head));
  const [formFrom, setFormFrom] = useState(chain.head);
  if (formFrom !== chain.head) {
    setFormFrom(chain.head);
    setForm(termsFormFrom(chain.head));
  }

  return (
    <Panel
      title="Hosted services and usage"
      summary={usageSummary(chain.head)}
      open={open}
      onToggle={onToggle}
      data-testid="usage-panel"
    >
      <LicenseTermsFields form={form} onChange={setForm} />
      <Text fontSize="xs" color="fg.muted">
        Saved on our side, on every live license of this customer. The install reads it on sync.
      </Text>
      <Button
        size="sm"
        alignSelf="start"
        loading={changes.isSavingTerms}
        onClick={() => void changes.saveTerms({ chain, form }).then((saved) => saved && onToggle())}
      >
        Save terms
      </Button>
    </Panel>
  );
}

function DangerZone({ chain, onRevoke }: { chain: LicenseChainState; onRevoke: Revoke }) {
  const changes = useLicenseChanges();
  const bound = chain.live.some((license) => license.instanceId !== null);
  if (chain.live.length === 0) return null;
  return (
    <Panel
      title="Danger zone"
      data-testid="danger-zone"
      actions={
        <HStack gap={2}>
          {bound ? (
            <Button
              size="xs"
              variant="ghost"
              loading={changes.isResetting}
              onClick={() => void changes.resetInstanceBinding({ chain })}
            >
              Reset instance binding
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            colorPalette="red"
            onClick={() => onRevoke(chain.inUse)}
          >
            Revoke license
          </Button>
        </HStack>
      }
    />
  );
}
