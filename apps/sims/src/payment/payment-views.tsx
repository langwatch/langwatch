import {
  Badge,
  IconButton,
  IconRefresh,
  Section,
  Stack,
  Table,
  type BadgeTone,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { SimRefusal, SimTime, useSimPoll } from "@langwatch/sim-console";
import type { ReactNode } from "react";

import {
  fetchCustomers,
  fetchEvents,
  fetchInvoices,
  fetchSessions,
  fetchSubscriptions,
  type EventRecord,
} from "./payment-api.ts";

const money = ({ cents, currency }: { cents: number; currency: string | null }) =>
  `${(cents / 100).toFixed(2)} ${(currency ?? "").toUpperCase()}`.trim();

const statusTone = (status: string | null): BadgeTone => {
  if (status === "active" || status === "paid" || status === "complete" || status === "succeeded")
    return "ok";
  if (status === "past_due" || status === "canceled" || status === "void") return "error";
  return "neutral";
};

const StatusBadge = ({ status }: { status: string | null }) => (
  <Badge tone={statusTone(status)}>{status ?? "draft"}</Badge>
);

/** One titled, polled, read-only table of what paymentsim holds. */
const ListView = <Row,>({
  title,
  description,
  rows,
  error,
  refresh,
  rowKey,
  columns,
  empty,
}: {
  title: string;
  description: string;
  rows: Row[];
  error?: Error;
  refresh: () => Promise<void>;
  rowKey: (row: Row) => string;
  columns: TableColumn<Row>[];
  empty: ReactNode;
}) => {
  return (
    <Section
      title={title}
      description={description}
      actions={
        <IconButton
          label="Refresh"
          icon={<IconRefresh />}
          size="sm"
          onClick={() => void refresh()}
        />
      }
    >
      <Stack gap={4}>
        {error ? (
          <SimRefusal message={error.message} />
        ) : (
          <Table caption={title} rows={rows} rowKey={rowKey} columns={columns} empty={empty} />
        )}
      </Stack>
    </Section>
  );
};

const created = { key: "created", header: "Created" } as const;

export const CustomersView = () => {
  const poll = useSimPoll({ fetch: fetchCustomers });
  return (
    <ListView
      title="Customers"
      description="Every customer the product created in this Stripe stand-in."
      rows={poll.data ?? []}
      error={poll.error}
      refresh={poll.refresh}
      rowKey={(row) => row.id}
      empty="No customers yet."
      columns={[
        { key: "id", header: "Customer", cell: (row) => row.id, mono: true },
        { key: "name", header: "Name", cell: (row) => row.name ?? "" },
        { key: "email", header: "Email", cell: (row) => row.email ?? "" },
        { ...created, cell: (row) => <SimTime at={row.created} /> },
      ]}
    />
  );
};

export const SubscriptionsView = () => {
  const poll = useSimPoll({ fetch: fetchSubscriptions });
  return (
    <ListView
      title="Subscriptions"
      description="Each subscription with its plan and status."
      rows={poll.data ?? []}
      error={poll.error}
      refresh={poll.refresh}
      rowKey={(row) => row.id}
      empty="No subscriptions yet."
      columns={[
        { key: "id", header: "Subscription", cell: (row) => row.id, mono: true },
        { key: "customer", header: "Customer", cell: (row) => row.customer, mono: true },
        {
          key: "plan",
          header: "Plan",
          cell: (row) =>
            row.items.data
              .map(
                (item) =>
                  `${item.price?.nickname ?? item.price?.lookup_key ?? item.price?.id ?? "price"}${
                    item.quantity === undefined ? "" : ` x${item.quantity}`
                  }`,
              )
              .join(", "),
        },
        {
          key: "status",
          header: "Status",
          cell: (row) => (
            <>
              <StatusBadge status={row.status} />
              {row.cancel_at_period_end ? " cancels at period end" : ""}
            </>
          ),
        },
        {
          key: "renews",
          header: "Period ends",
          cell: (row) => <SimTime at={row.current_period_end} />,
        },
      ]}
    />
  );
};

export const SessionsView = () => {
  const poll = useSimPoll({ fetch: fetchSessions });
  return (
    <ListView
      title="Checkout sessions"
      description="Checkout sessions the product opened, and whether they were paid."
      rows={poll.data ?? []}
      error={poll.error}
      refresh={poll.refresh}
      rowKey={(row) => row.id}
      empty="No checkout sessions yet."
      columns={[
        { key: "id", header: "Session", cell: (row) => row.id, mono: true },
        { key: "mode", header: "Mode", cell: (row) => row.mode },
        { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        {
          key: "payment",
          header: "Payment",
          cell: (row) => <StatusBadge status={row.payment_status} />,
        },
        { key: "customer", header: "Customer", cell: (row) => row.customer ?? "", mono: true },
        {
          key: "total",
          header: "Total",
          cell: (row) => money({ cents: row.amount_total, currency: row.currency }),
          align: "end",
        },
        { ...created, cell: (row) => <SimTime at={row.created} /> },
      ]}
    />
  );
};

export const InvoicesView = () => {
  const poll = useSimPoll({ fetch: fetchInvoices });
  return (
    <ListView
      title="Invoices"
      description="Every invoice, newest first."
      rows={poll.data ?? []}
      error={poll.error}
      refresh={poll.refresh}
      rowKey={(row) => row.id}
      empty="No invoices yet."
      columns={[
        { key: "id", header: "Invoice", cell: (row) => row.id, mono: true },
        { key: "customer", header: "Customer", cell: (row) => row.customer, mono: true },
        { key: "reason", header: "Reason", cell: (row) => row.billing_reason },
        { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        {
          key: "total",
          header: "Total",
          cell: (row) => money({ cents: row.total, currency: row.currency }),
          align: "end",
        },
        { ...created, cell: (row) => <SimTime at={row.created} /> },
      ]}
    />
  );
};

/** Where an event stands with the app's webhook endpoint. */
export const deliveryOf = ({ record, queued }: { record: EventRecord; queued: boolean }) => {
  const last = record.attempts.at(-1);
  if (last === undefined)
    return { label: queued ? "queued" : "not sent", tone: "neutral" as const };
  const ok = last.error === undefined && last.status >= 200 && last.status < 300;
  const label = ok ? "delivered" : `failed (${last.error ?? last.status})`;
  return { label, tone: ok ? ("ok" as const) : ("error" as const) };
};

export const EventsView = () => {
  const events = useSimPoll({ fetch: fetchEvents });
  const queued = new Set(events.data?.pending ?? []);
  const rows = [...(events.data?.events ?? [])].reverse();
  return (
    <ListView
      title="Webhook events"
      description={`Events paymentsim sent to the app${events.data?.held ? " (delivery is held)" : ""}, with their delivery status.`}
      rows={rows}
      error={events.error}
      refresh={events.refresh}
      rowKey={(row: EventRecord) => row.event.id}
      empty="No events yet."
      columns={[
        { key: "id", header: "Event", cell: (row: EventRecord) => row.event.id, mono: true },
        { key: "type", header: "Type", cell: (row: EventRecord) => row.event.type },
        {
          key: "delivery",
          header: "Delivery",
          cell: (row: EventRecord) => {
            const { label, tone } = deliveryOf({ record: row, queued: queued.has(row.event.id) });
            return <Badge tone={tone}>{label}</Badge>;
          },
        },
        {
          key: "attempts",
          header: "Attempts",
          cell: (row: EventRecord) => row.attempts.length,
          align: "end",
        },
        { ...created, cell: (row: EventRecord) => <SimTime at={row.event.created} /> },
      ]}
    />
  );
};
