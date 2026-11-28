// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describeError } from "@langwatch/browser-host/errors";
import { Button, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import type { LicenseBillingSectionProps } from "@langwatch/enterprise-billing-client";
import type { ConnectedBillingOverview } from "@langwatch/enterprise-billing-contract";
import { currentTimeZone, nowInstant, Temporal } from "@langwatch/time";
import { useEffect, useState, type ReactNode } from "react";

import { connectedBillingApi } from "../../behavior/connected-billing-api.ts";
import { useConnectedBillingCommands } from "../../behavior/use-connected-billing-commands.ts";
import {
  annualInvoiceText,
  type BillingForm,
  billingFormFrom,
  contractPayload,
  dollarsToCents,
  needsLicenseSigned,
  nextPaidTerm,
  onboardPayload,
  paidTermProblem,
  termEndInstant,
} from "../../model/connected-billing-form.ts";
import { ConnectedBillingFields } from "../blocks/connected-billing-fields.tsx";
import { ConnectedBillingState, OpenInvoices } from "../blocks/connected-billing-state.tsx";

const DAY_FORMAT = { month: "short", day: "numeric", year: "numeric" } as const;

/** A calendar day of the form, `YYYY-MM-DD`, as the drawer prints days: "Dec 14, 2026". */
const formLabel = (day: string): string =>
  Temporal.PlainDate.from(day).toLocaleString("en-US", DAY_FORMAT);

/** The local day an instant falls on, printed the same way. */
const dayLabel = (iso: string): string =>
  Temporal.Instant.from(iso)
    .toZonedDateTimeISO(currentTimeZone())
    .toPlainDate()
    .toLocaleString("en-US", DAY_FORMAT);

/**
 * Billed once onboarding sent the annual invoice, its last step. An account
 * without one stopped part way, and Start billing finishes it.
 */
const isBilled = (overview: ConnectedBillingOverview): boolean =>
  overview.account !== null && overview.invoices.some((invoice) => invoice.kind === "annual");

function billingStateOf(overview: ConnectedBillingOverview | undefined): "trial" | "billed" | null {
  if (!overview) return null;
  return isBilled(overview) ? "billed" : "trial";
}

/**
 * Invoice billing for a connected customer, on the license it was sold with. A
 * license with no billing account is a trial: one line and Start billing.
 */
export default function LicenseBillingSection(license: LicenseBillingSectionProps) {
  const query = connectedBillingApi.connectedBilling.get.useQuery(
    { organizationId: license.organizationId },
    {
      retry: false,
      // needs a read hint: seat change settled on the worker (about a minute)
    },
  );
  const state = billingStateOf(query.data);
  const { onBillingState } = license;
  useEffect(() => {
    if (state) onBillingState?.(state);
  }, [state, onBillingState]);

  if (query.error) {
    return (
      <BillingFrame summary="Couldn't load billing">
        <Text color="fg.error" fontSize="sm">
          {describeError({
            error: query.error,
            fallbackTitle: "Couldn't load billing for this license",
          })}
        </Text>
      </BillingFrame>
    );
  }
  if (!query.data) return <BillingFrame summary="Loading…" />;
  return isBilled(query.data) ? (
    <BilledPanel license={license} overview={query.data} />
  ) : (
    <TrialPanel license={license} overview={query.data} />
  );
}

function BillingFrame({
  summary,
  actions,
  children,
}: {
  summary: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <VStack
      align="stretch"
      gap={0}
      width="full"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      data-testid="license-billing"
    >
      <HStack gap={3} paddingX={4} paddingY={3}>
        <VStack align="start" gap={0} flex={1}>
          <Text fontWeight="semibold" fontSize="sm">
            Billing
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {summary}
          </Text>
        </VStack>
        {actions}
      </HStack>
      {children ? (
        <VStack
          align="stretch"
          gap={4}
          paddingX={4}
          paddingY={3}
          borderTopWidth="1px"
          borderColor="border"
        >
          {children}
        </VStack>
      ) : null}
    </VStack>
  );
}

const today = (): string => nowInstant().toZonedDateTimeISO("UTC").toPlainDate().toString();

/**
 * The paid-term form and its run: signs the license to the term first, then
 * bills, and says which step failed. While a signed term waits for billing the
 * form keeps that term, so a retry bills it instead of the term after it.
 */
function usePaidTerm({
  license,
  overview,
}: {
  license: LicenseBillingSectionProps;
  overview: ConnectedBillingOverview;
}) {
  const [heldExpiry, setHeldExpiry] = useState<string | null>(null);
  const seed = () => ({
    ...billingFormFrom({ account: overview.account, license }),
    ...nextPaidTerm({
      account: overview.account,
      license,
      today: today(),
      finished: isBilled(overview),
    }),
    seats: String(license.maxMembers),
  });
  const [form, setForm] = useState<BillingForm>(seed);
  const seededKey = `${overview.account?.id ?? "trial"}:${overview.account?.termEndsAt ?? ""}:${heldExpiry ?? license.expiresAt}:${license.maxMembers}`;
  const [seededFrom, setSeededFrom] = useState(seededKey);
  if (seededFrom !== seededKey) {
    setSeededFrom(seededKey);
    setForm(seed());
  }
  const [failure, setFailure] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const problem = paidTermProblem(form);

  const run = async (bill: () => Promise<unknown>) => {
    if (problem) return false;
    setFailure(null);
    setIsRunning(true);
    try {
      if (license.signPaidTerm && needsLicenseSigned({ form, license })) {
        setHeldExpiry(license.expiresAt);
        const signed = await license.signPaidTerm({ expiresAt: termEndInstant(form) });
        if (!signed) {
          setHeldExpiry(null);
          setFailure("The license step failed, so nothing was billed.");
          return false;
        }
      }
      try {
        await bill();
      } catch {
        setFailure(
          `The license now runs to ${formLabel(form.termEndsAt)}, but billing did not start. Try again to finish.`,
        );
        return false;
      }
      setHeldExpiry(null);
      return true;
    } finally {
      setIsRunning(false);
    }
  };
  const cancel = () => {
    setHeldExpiry(null);
    setFailure(null);
  };
  return { form, setForm, problem, run, cancel, failure, isRunning };
}

function WhatItDoes({ steps }: { steps: string[] }) {
  return (
    <VStack align="stretch" gap={1} fontSize="sm" data-testid="paid-term-steps">
      <Text fontWeight="medium">{`This does ${steps.length === 3 ? "three" : "two"} things`}</Text>
      {steps.map((step, index) => (
        <Text key={step}>{`${index + 1}. ${step}`}</Text>
      ))}
    </VStack>
  );
}

function TrialPanel({
  license,
  overview,
}: {
  license: LicenseBillingSectionProps;
  overview: ConnectedBillingOverview;
}) {
  const commands = useConnectedBillingCommands();
  const [open, setOpen] = useState(false);
  const { form, setForm, problem, run, cancel, failure, isRunning } = usePaidTerm({
    license,
    overview,
  });
  const signs = needsLicenseSigned({ form, license });

  return (
    <BillingFrame
      summary={
        overview.account
          ? "Billing was started but did not finish. Start billing again to finish it."
          : `Not billed. The trial ends ${dayLabel(license.expiresAt)}.`
      }
      actions={
        open ? undefined : (
          <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
            Start billing
          </Button>
        )
      }
    >
      {open ? (
        <>
          <ConnectedBillingFields
            form={form}
            onChange={setForm}
            showPaymentFields
            seatsFromLicense
          />
          <PaidTermProblem problem={problem} />
          <WhatItDoes
            steps={[
              ...(signs && !problem
                ? [
                    `Signs the license to ${formLabel(form.termEndsAt)}. The install picks it up on its next sync.`,
                  ]
                : []),
              "Creates the billing customer and the quarterly usage subscription.",
              `Sends the annual invoice: ${annualInvoiceText(form)}.`,
            ]}
          />
          {failure ? (
            <Text color="fg.error" fontSize="sm" data-testid="paid-term-failure">
              {failure}
            </Text>
          ) : null}
          <HStack gap={2} justify="end">
            <Button
              size="sm"
              variant="ghost"
              disabled={isRunning}
              onClick={() => {
                cancel();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={isRunning}
              disabled={problem !== undefined}
              onClick={() =>
                void run(() =>
                  commands.onboard.mutateAsync(onboardPayload({ form, license })),
                ).then((done) => done && setOpen(false))
              }
            >
              Start billing
            </Button>
          </HStack>
        </>
      ) : null}
    </BillingFrame>
  );
}

function BilledPanel({
  license,
  overview,
}: {
  license: LicenseBillingSectionProps;
  overview: ConnectedBillingOverview;
}) {
  const commands = useConnectedBillingCommands();
  const [renewing, setRenewing] = useState(false);
  const { form, setForm, problem, run, cancel, failure, isRunning } = usePaidTerm({
    license,
    overview,
  });
  const signs = needsLicenseSigned({ form, license });

  return (
    <BillingFrame summary="Invoices, renewals and payment">
      <ConnectedBillingState overview={overview} />
      <OpenInvoices
        overview={overview}
        isMarking={commands.markPaidOutOfBand.isPending}
        onMarkPaid={(stripeInvoiceId) => commands.markPaidOutOfBand.mutate({ stripeInvoiceId })}
      />
      {renewing ? (
        <VStack align="stretch" gap={3} padding={3} borderRadius="md" bg="bg.subtle">
          <ConnectedBillingFields
            form={form}
            onChange={setForm}
            showPaymentFields={false}
            seatsFromLicense
          />
          <PaidTermProblem problem={problem} />
          <WhatItDoes
            steps={[
              ...(signs && !problem
                ? [
                    `Signs the license to ${formLabel(form.termEndsAt)}. The install picks it up on its next sync.`,
                  ]
                : []),
              `Renews the contract and sends the invoice: ${annualInvoiceText(form)}.`,
            ]}
          />
          {failure ? (
            <Text color="fg.error" fontSize="sm" data-testid="paid-term-failure">
              {failure}
            </Text>
          ) : null}
          <HStack gap={2} justify="end">
            <Button
              size="sm"
              variant="ghost"
              disabled={isRunning}
              onClick={() => {
                cancel();
                setRenewing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={isRunning}
              disabled={problem !== undefined}
              onClick={() =>
                void run(() =>
                  commands.renew.mutateAsync(
                    contractPayload({ form, organizationId: license.organizationId }),
                  ),
                ).then((done) => done && setRenewing(false))
              }
            >
              Renew
            </Button>
          </HStack>
        </VStack>
      ) : (
        <HStack gap={3} wrap="wrap">
          <Button size="sm" variant="outline" onClick={() => setRenewing(true)}>
            Renew for the next term
          </Button>
          <AddCommit organizationId={license.organizationId} />
        </HStack>
      )}
    </BillingFrame>
  );
}

function PaidTermProblem({ problem }: { problem: string | undefined }) {
  if (!problem) return null;
  return (
    <Text color="fg.error" fontSize="sm" data-testid="paid-term-problem">
      {problem}
    </Text>
  );
}

function AddCommit({ organizationId }: { organizationId: string }) {
  const commands = useConnectedBillingCommands();
  const [amount, setAmount] = useState("");
  const amountUsdCents = dollarsToCents(amount) ?? 0;
  return (
    <HStack gap={2}>
      <Input
        size="sm"
        width="32"
        type="number"
        min={0}
        step="0.01"
        placeholder="Amount (USD)"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        loading={commands.addCommit.isPending}
        disabled={amountUsdCents <= 0}
        onClick={() => commands.addCommit.mutate({ organizationId, amountUsdCents })}
      >
        Add commit
      </Button>
    </HStack>
  );
}
