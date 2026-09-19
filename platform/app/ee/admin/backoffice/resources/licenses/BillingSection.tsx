import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { api } from "~/utils/api";
import { BillingFields } from "./BillingFields";
import { BillingState, OpenInvoices } from "./BillingState";
import {
  type BillingForm,
  type BillingOverview,
  billingFormFrom,
  contractPayload,
  onboardPayload,
} from "./billingForm";
import { Section } from "./DrawerSection";
import { dollarsToCents } from "./terms";
import type { License } from "./types";
import { useConnectedBillingCommands } from "./useConnectedBillingCommands";

/** Invoice billing for a connected customer, on the license it was sold with. */
export function BillingSection({ license }: { license: License }) {
  const organizationId = license.organizationId;
  const query = api.connectedBilling.get.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: Boolean(organizationId), retry: false },
  );

  if (!organizationId) return null;
  return (
    <Section title="Billing">
      {query.data ? (
        <BillingPanel license={license} overview={query.data} />
      ) : (
        <Text color="fg.muted">Loading...</Text>
      )}
    </Section>
  );
}

function BillingPanel({
  license,
  overview,
}: {
  license: License;
  overview: BillingOverview;
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
      <BillingState overview={overview} />
      <BillingFields
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
              commands.renew.mutate({
                organizationId: license.organizationId ?? "",
                ...contractPayload(form),
              })
            }
          >
            Renew for this term
          </Button>
        ) : (
          <Button
            size="sm"
            loading={commands.onboard.isPending}
            onClick={() =>
              commands.onboard.mutate(onboardPayload({ form, license }))
            }
          >
            Onboard customer
          </Button>
        )}
        {overview.account ? <AddCommit license={license} /> : null}
      </HStack>
      <OpenInvoices
        overview={overview}
        isMarking={commands.markPaidOutOfBand.isPending}
        onMarkPaid={(stripeInvoiceId) =>
          commands.markPaidOutOfBand.mutate({ stripeInvoiceId })
        }
      />
    </VStack>
  );
}

function AddCommit({ license }: { license: License }) {
  const commands = useConnectedBillingCommands();
  const [amount, setAmount] = useState("");
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
        disabled={(dollarsToCents(amount) ?? 0) <= 0}
        onClick={() =>
          commands.addCommit.mutate({
            organizationId: license.organizationId ?? "",
            amountUsdCents: dollarsToCents(amount) ?? 0,
          })
        }
      >
        Add commit
      </Button>
    </HStack>
  );
}
