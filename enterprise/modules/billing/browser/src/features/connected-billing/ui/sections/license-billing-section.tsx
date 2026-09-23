import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { UiLicenseBillingSectionProps } from "@langwatch/browser-host/declarations";
import { describeError } from "@langwatch/browser-host/errors";
import type { ConnectedBillingOverview } from "@langwatch/enterprise-billing-contract";
import { useEffect, useState } from "react";

import { connectedBillingApi } from "../../behavior/connected-billing-api.ts";
import { useConnectedBillingCommands } from "../../behavior/use-connected-billing-commands.ts";
import {
  type BillingForm,
  billingFormFrom,
  contractPayload,
  dollarsToCents,
  onboardPayload,
} from "../../model/connected-billing-form.ts";
import { ConnectedBillingFields } from "../blocks/connected-billing-fields.tsx";
import { ConnectedBillingState, OpenInvoices } from "../blocks/connected-billing-state.tsx";

/** Invoice billing for a connected customer, on the license it was sold with. */
export default function LicenseBillingSection(license: UiLicenseBillingSectionProps) {
  const query = connectedBillingApi.connectedBilling.get.useQuery(
    { organizationId: license.organizationId },
    { retry: false },
  );

  return (
    <VStack
      align="start"
      gap={3}
      width="full"
      borderTopWidth="1px"
      borderColor="border"
      paddingTop={4}
    >
      <Text fontWeight="semibold">Billing</Text>
      <BillingBody license={license} query={query} />
    </VStack>
  );
}

function BillingBody({
  license,
  query,
}: {
  license: UiLicenseBillingSectionProps;
  query: { error: unknown; data: ConnectedBillingOverview | undefined };
}) {
  if (query.error) {
    return (
      <Text color="fg.error">
        {describeError({
          error: query.error,
          fallbackTitle: "Couldn't load billing for this license",
        })}
      </Text>
    );
  }
  if (!query.data) return <Text color="fg.muted">Loading…</Text>;
  return <BillingPanel license={license} overview={query.data} />;
}

function BillingPanel({
  license,
  overview,
}: {
  license: UiLicenseBillingSectionProps;
  overview: ConnectedBillingOverview;
}) {
  const commands = useConnectedBillingCommands();
  const [form, setForm] = useState<BillingForm>(() =>
    billingFormFrom({ account: overview.account, license }),
  );

  useEffect(() => {
    setForm(billingFormFrom({ account: overview.account, license }));
  }, [overview.account, license]);

  return (
    <VStack align="start" gap={4} width="full">
      <ConnectedBillingState overview={overview} />
      <ConnectedBillingFields
        form={form}
        onChange={setForm}
        showPaymentFields={!overview.account}
      />
      <HStack gap={3}>
        {overview.account ? (
          <Button
            size="sm"
            loading={commands.renew.isPending}
            onClick={() =>
              commands.renew.mutate(
                contractPayload({ form, organizationId: license.organizationId }),
              )
            }
          >
            Renew for this term
          </Button>
        ) : (
          <Button
            size="sm"
            loading={commands.onboard.isPending}
            onClick={() => commands.onboard.mutate(onboardPayload({ form, license }))}
          >
            Onboard customer
          </Button>
        )}
        {overview.account ? <AddCommit organizationId={license.organizationId} /> : null}
      </HStack>
      <OpenInvoices
        overview={overview}
        isMarking={commands.markPaidOutOfBand.isPending}
        onMarkPaid={(stripeInvoiceId) => commands.markPaidOutOfBand.mutate({ stripeInvoiceId })}
      />
    </VStack>
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
