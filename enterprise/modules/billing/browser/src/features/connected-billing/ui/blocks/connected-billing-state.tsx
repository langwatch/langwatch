// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  Badge,
  Button,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { ConnectedBillingOverview } from "@langwatch/enterprise-billing-contract";
import { Temporal } from "@langwatch/time";
import type { ReactNode } from "react";

import { money } from "../../model/connected-billing-form.ts";
import {
  isSeatChangeUnsettled,
  seatChangeBadge,
  seatChangeOutcome,
} from "../../model/seat-change-copy.ts";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="start" gap={0}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text as="div">{children}</Text>
    </VStack>
  );
}

const Missing = ({ children }: { children: ReactNode }) => (
  <Text as="span" color="fg.muted">
    {children}
  </Text>
);

const day = (iso: string): string =>
  Temporal.Instant.from(iso).toZonedDateTimeISO("UTC").toPlainDate().toLocaleString();

/** The commercial state of a connected customer, as finance reads it. */
export function ConnectedBillingState({ overview }: { overview: ConnectedBillingOverview }) {
  const { account, spend, terms, seats } = overview;

  return (
    <VStack align="start" gap={3} width="full">
      <SimpleGrid columns={2} gap={3} width="full" fontSize="sm">
        <Detail label="Commit">
          {money(account?.commitUsdCents ?? terms.commitUsdCents, "USD")}
        </Detail>
        <Detail label="Drawn down">
          {spend.spentUsdCents === null ? (
            <Missing>unavailable</Missing>
          ) : (
            money(spend.spentUsdCents, "USD")
          )}
        </Detail>
        <Detail label="On-demand overage">
          {terms.overageEnabled
            ? `on, up to ${money(terms.maximumUsdCents - terms.commitUsdCents, "USD")}`
            : "off"}
        </Detail>
        <Detail label="Seats">
          {`${seats.licensed} licensed, ${seats.reported === null ? "none reported" : `${seats.reported} reported`}`}
        </Detail>
        <Detail label="Last sync">
          {seats.lastSyncAt ? (
            Temporal.Instant.from(seats.lastSyncAt).toLocaleString()
          ) : (
            <Missing>never synced</Missing>
          )}
        </Detail>
        <Detail label="Term">
          {account ? (
            `${day(account.termStartsAt)} to ${day(account.termEndsAt)}`
          ) : (
            <Missing>not onboarded</Missing>
          )}
        </Detail>
      </SimpleGrid>
      <SeatChanges overview={overview} />
    </VStack>
  );
}

/** One line per mid-term seat change, newest first, with how its invoicing stands. */
function SeatChanges({ overview }: { overview: ConnectedBillingOverview }) {
  if (overview.seatChanges.length === 0) return null;
  return (
    <VStack align="start" gap={1} width="full">
      {overview.seatChanges.map((change) => (
        <HStack key={change.licenseId} gap={2} fontSize="xs">
          <Badge colorPalette={isSeatChangeUnsettled(change) ? "orange" : "gray"}>
            {seatChangeBadge(change)}
          </Badge>
          <Text color="fg.muted">
            {`${day(change.changedAt)}: ${change.addedSeats} seat(s) added. ${seatChangeOutcome(change)}`}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

/** Invoices still owed, each one markable as paid when the wire arrives. */
export function OpenInvoices({
  overview,
  onMarkPaid,
  isMarking,
}: {
  overview: ConnectedBillingOverview;
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
