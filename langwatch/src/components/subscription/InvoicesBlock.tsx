/**
 * InvoicesBlock - displays recent invoices from Stripe.
 *
 * Shows a card with a table of recent invoices including invoice number,
 * date, amount, status badge, and PDF download link.
 */
import {
  Badge,
  Card,
  Flex,
  HStack,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Download, ExternalLink } from "lucide-react";
import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";
import {
  getInvoiceStatusColor,
  formatInvoiceDate,
  formatInvoiceAmount,
} from "./invoice-utils";

export function InvoicesBlock({
  organizationId,
  onViewAllInStripe,
}: {
  organizationId: string;
  onViewAllInStripe?: () => void;
}) {
  const invoices = api.subscription.listInvoices.useQuery({ organizationId });

  return (
    <Card.Root
      data-testid="invoices-block"
      borderWidth={1}
      borderColor="gray.200"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={4}>
          <Flex justifyContent="space-between" alignItems="center">
            <Text fontWeight="semibold" fontSize="lg">
              Recent Invoices
            </Text>
            {!invoices.isLoading &&
              !invoices.isError &&
              invoices.data &&
              invoices.data.length > 0 &&
              onViewAllInStripe && (
                <Text
                  data-testid="view-all-invoices-link"
                  as="button"
                  fontSize="sm"
                  color="gray.600"
                  cursor="pointer"
                  _hover={{ color: "blue.500" }}
                  onClick={onViewAllInStripe}
                >
                  <HStack gap={1}>
                    <span>View all in Stripe</span>
                    <ExternalLink size={14} />
                  </HStack>
                </Text>
              )}
          </Flex>

          {invoices.isLoading && (
            <VStack data-testid="invoices-loading" gap={2}>
              <Skeleton height="20px" width="100%" />
              <Skeleton height="20px" width="100%" />
              <Skeleton height="20px" width="100%" />
            </VStack>
          )}

          {invoices.isError && (
            <Text color="red.500" fontSize="sm">
              Failed to load invoices. Please try again later.
            </Text>
          )}

          {!invoices.isLoading &&
            !invoices.isError &&
            invoices.data?.length === 0 && (
              <Text
                color="gray.500"
                fontSize="sm"
                textAlign="center"
                paddingY={4}
              >
                No invoices yet
              </Text>
            )}

          {!invoices.isLoading &&
            !invoices.isError &&
            invoices.data &&
            invoices.data.length > 0 && (
              <Table.Root size="sm" variant="outline">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Invoice #</Table.ColumnHeader>
                    <Table.ColumnHeader>Date</Table.ColumnHeader>
                    <Table.ColumnHeader>Amount</Table.ColumnHeader>
                    <Table.ColumnHeader>Status</Table.ColumnHeader>
                    <Table.ColumnHeader>Actions</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {invoices.data.map((invoice) => (
                    <Table.Row key={invoice.id}>
                      <Table.Cell>
                        <Text fontSize="sm">
                          {invoice.number ?? "--"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="sm">
                          {formatInvoiceDate(invoice.date)}
                        </Text>
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
                        <Badge
                          colorPalette={getInvoiceStatusColor(invoice.status)}
                          variant="subtle"
                          borderRadius="md"
                          paddingX={2}
                          paddingY={0.5}
                          fontSize="xs"
                        >
                          {invoice.status}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        {invoice.pdfUrl && (
                          <Link
                            data-testid={`invoice-pdf-${invoice.id}`}
                            href={invoice.pdfUrl}
                            isExternal
                            target="_blank"
                          >
                            <HStack gap={1} color="blue.500" fontSize="sm">
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
            )}


        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
