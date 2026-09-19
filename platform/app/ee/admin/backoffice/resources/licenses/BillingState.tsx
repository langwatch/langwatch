import {
  Badge,
  Button,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { EmptyCell, formatDateTime } from "../../BackofficeTable";
import type { BillingOverview } from "./billingForm";
import { Detail } from "./DrawerSection";

const CENTS = 100;

const money = (cents: number, currency: string): string =>
  `${(cents / CENTS).toFixed(2)} ${currency}`;

/** The commercial state of a connected customer, as finance reads it. */
export function BillingState({ overview }: { overview: BillingOverview }) {
  const { account, spend, terms, seats } = overview;
  const drawnDown =
    spend.spentUsdCents === null ? null : money(spend.spentUsdCents, "USD");

  return (
    <VStack align="start" gap={3} width="full">
      <SimpleGrid columns={2} gap={3} width="full" fontSize="sm">
        <Detail label="Commit">
          {money(account?.commitUsdCents ?? terms.commitUsdCents, "USD")}
        </Detail>
        <Detail label="Drawn down">
          {drawnDown ?? <EmptyCell>unavailable</EmptyCell>}
        </Detail>
        <Detail label="On-demand overage">
          {terms.overageEnabled
            ? `on, up to ${money(terms.maximumUsdCents - terms.commitUsdCents, "USD")}`
            : "off"}
        </Detail>
        <Detail label="Seats">
          {seats.licensed} licensed,{" "}
          {seats.reported === null
            ? "none reported"
            : `${seats.reported} reported`}
          {seats.currentQuarterPeak === null
            ? ""
            : `, ${seats.currentQuarterPeak} peak this quarter`}
        </Detail>
        <Detail label="Last sync">
          {seats.lastSyncAt ? (
            formatDateTime(seats.lastSyncAt)
          ) : (
            <EmptyCell>never synced</EmptyCell>
          )}
        </Detail>
        <Detail label="Term">
          {account ? (
            `${account.termStartsAt.toLocaleDateString()} to ${account.termEndsAt.toLocaleDateString()}`
          ) : (
            <EmptyCell>not onboarded</EmptyCell>
          )}
        </Detail>
      </SimpleGrid>
      <FlaggedTrueUps overview={overview} />
    </VStack>
  );
}

function FlaggedTrueUps({ overview }: { overview: BillingOverview }) {
  const flagged = overview.trueUps.filter((row) => row.state === "flagged");
  if (flagged.length === 0) return null;
  return (
    <HStack gap={2}>
      <Badge colorPalette="orange">Seat true-up needs follow-up</Badge>
      <Text fontSize="xs" color="fg.muted">
        {flagged.length} quarter(s) closed without a sync, so no seats were
        invoiced on a guess.
      </Text>
    </HStack>
  );
}

/** Invoices still owed, each one markable as paid when the wire arrives. */
export function OpenInvoices({
  overview,
  onMarkPaid,
  isMarking,
}: {
  overview: BillingOverview;
  onMarkPaid: (stripeInvoiceId: string) => void;
  isMarking: boolean;
}) {
  const open = overview.invoices.filter(
    (invoice) => invoice.status !== "paid" && invoice.paidOutOfBandAt === null,
  );
  if (open.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No open invoices.
      </Text>
    );
  }
  return (
    <VStack align="start" gap={2} width="full">
      {open.map((invoice) => (
        <HStack key={invoice.stripeInvoiceId} gap={3} fontSize="sm">
          <Text>{invoice.stripeInvoiceId}</Text>
          <Badge>{invoice.kind}</Badge>
          <Text>{money(invoice.amountCents, invoice.currency)}</Text>
          <Text color="fg.muted">{invoice.status}</Text>
          <Button
            size="xs"
            variant="outline"
            loading={isMarking}
            onClick={() => onMarkPaid(invoice.stripeInvoiceId)}
          >
            Mark paid out of band
          </Button>
        </HStack>
      ))}
    </VStack>
  );
}
