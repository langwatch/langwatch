import { Link } from "@langwatch/browser-host/link";
import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
/**
 * InvoicesBlock — a card of recent Stripe invoices: number, date, amount,
 * status chip, and PDF download link.
 */
import { HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { type StatusChipTone, StatusChip } from "@langwatch/design-system/settings-card";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { Download, ExternalLink, Receipt } from "lucide-react";

import { billingApi } from "../../behavior/billing-api.ts";
import {
  formatInvoiceAmount,
  formatInvoiceDate,
  getInvoiceStatusColor,
} from "../../model/invoice-utils.ts";

const TONE_OF_PALETTE: Record<string, StatusChipTone> = {
  green: "good",
  yellow: "warning",
  red: "bad",
};

export function InvoicesBlock({
  organizationId,
  onViewAllInStripe,
}: {
  organizationId: string;
  onViewAllInStripe?: () => void;
}) {
  const invoices = billingApi.subscription.listInvoices.useQuery({ organizationId });
  const rows = !invoices.isLoading && !invoices.isError ? invoices.data : undefined;

  return (
    <SettingsSection
      divided={false}
      data-testid="invoices-block"
      icon={<Receipt size={18} />}
      title="Invoices"
      hint="Your recent invoices, as Stripe issued them."
      actions={
        rows &&
        rows.length > 0 &&
        onViewAllInStripe && (
          <Text
            data-testid="view-all-invoices-link"
            as="button"
            fontSize="sm"
            color="orange.fg"
            cursor="pointer"
            onClick={onViewAllInStripe}
          >
            <HStack gap={1}>
              <span>View all in Stripe</span>
              <ExternalLink size={14} />
            </HStack>
          </Text>
        )
      }
    >
      {invoices.isLoading && (
        <Card data-testid="invoices-loading">
          <VStack gap={4} width="full">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} height="20px" width="100%" />
            ))}
          </VStack>
        </Card>
      )}

      {invoices.isError && (
        <Banner status="error">Failed to load invoices. Please try again later.</Banner>
      )}

      {rows?.length === 0 && (
        <NoDataInfoBlock
          icon={<Receipt />}
          title="No invoices yet"
          description="Invoices appear here once your subscription has billed."
        />
      )}

      {rows && rows.length > 0 && (
        <ListTable scroll="x" scrollLabel="Invoices">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Invoice</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Date</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Amount</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
              <ListTable.ActionHeader label="Invoice PDF" />
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {rows.map((invoice) => (
              <ListTable.Row key={invoice.id}>
                <ListTable.Cell>
                  <HStack gap={3}>
                    <Receipt size={16} />
                    <Text fontWeight="medium">{invoice.number ?? "--"}</Text>
                  </HStack>
                </ListTable.Cell>
                <ListTable.Cell>
                  <Text color="fg.muted">{formatInvoiceDate(invoice.date)}</Text>
                </ListTable.Cell>
                <ListTable.Cell align="end">
                  <Text fontVariantNumeric="tabular-nums">
                    {formatInvoiceAmount({
                      amountCents: invoice.amountDue,
                      currency: invoice.currency,
                    })}
                  </Text>
                </ListTable.Cell>
                <ListTable.Cell>
                  <StatusChip
                    label={invoice.status}
                    tone={TONE_OF_PALETTE[getInvoiceStatusColor(invoice.status)] ?? "neutral"}
                  />
                </ListTable.Cell>
                <ListTable.ActionCell>
                  {invoice.pdfUrl && (
                    <Link
                      data-testid={`invoice-pdf-${invoice.id}`}
                      href={invoice.pdfUrl}
                      isExternal
                      aria-label={`Download PDF for invoice ${invoice.number ?? invoice.id}`}
                    >
                      <HStack gap={1} color="orange.fg" justify="end">
                        <Download size={14} />
                        <Text>PDF</Text>
                      </HStack>
                    </Link>
                  )}
                </ListTable.ActionCell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      )}
    </SettingsSection>
  );
}
