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
        <VStack data-testid="invoices-loading" gap={2} width="full">
          <Skeleton height="20px" width="100%" />
          <Skeleton height="20px" width="100%" />
          <Skeleton height="20px" width="100%" />
        </VStack>
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
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                {["Invoice #", "Date", "Amount", "Status", "Actions"].map((column) => (
                  <Table.ColumnHeader
                    key={column}
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="wide"
                    color="fg.muted"
                  >
                    {column}
                  </Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((invoice) => (
                <Table.Row key={invoice.id}>
                  <Table.Cell>
                    <Text fontSize="sm">{invoice.number ?? "--"}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="sm">{formatInvoiceDate(invoice.date)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="sm">
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
                  <Table.Cell>
                    {invoice.pdfUrl && (
                      <Link
                        data-testid={`invoice-pdf-${invoice.id}`}
                        href={invoice.pdfUrl}
                        isExternal
                        aria-label={`Download PDF for invoice ${invoice.number ?? invoice.id}`}
                      >
                        <HStack gap={1} color="orange.fg" fontSize="sm">
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
        </Card.Root>
      )}
    </SettingsSection>
  );
}
