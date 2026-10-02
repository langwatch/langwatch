import { Link } from "@langwatch/browser-host/link";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
/**
 * InvoicesBlock — a card of recent Stripe invoices: number, date, amount,
 * status chip, and PDF download link.
 */
import {
  Alert,
  Card,
  HStack,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
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
        <Card.Root data-testid="invoices-loading" width="full" padding={4}>
          <VStack gap={4} width="full">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} height="20px" width="100%" />
            ))}
          </VStack>
        </Card.Root>
      )}

      {invoices.isError && (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Failed to load invoices. Please try again later.</Alert.Title>
          </Alert.Content>
        </Alert.Root>
      )}

      {rows?.length === 0 && (
        <NoDataInfoBlock
          icon={<Receipt />}
          title="No invoices yet"
          description="Invoices appear here once your subscription has billed."
        />
      )}

      {rows && rows.length > 0 && (
        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0} overflowX="auto">
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Invoice</Table.ColumnHeader>
                  <Table.ColumnHeader>Date</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="right">Amount</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader width="80px" textAlign="right" />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((invoice) => (
                  <Table.Row key={invoice.id}>
                    <Table.Cell>
                      <HStack gap={3}>
                        <Receipt size={16} />
                        <Text fontWeight="medium">{invoice.number ?? "--"}</Text>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Text color="fg.muted">{formatInvoiceDate(invoice.date)}</Text>
                    </Table.Cell>
                    <Table.Cell textAlign="right">
                      <Text fontVariantNumeric="tabular-nums">
                        {formatInvoiceAmount({
                          amountCents: invoice.amountDue,
                          currency: invoice.currency,
                        })}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <StatusChip
                        label={invoice.status}
                        tone={TONE_OF_PALETTE[getInvoiceStatusColor(invoice.status)] ?? "neutral"}
                      />
                    </Table.Cell>
                    <Table.Cell textAlign="right">
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
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>
      )}
    </SettingsSection>
  );
}
