import { simFetch } from "@langwatch/sim-console";
import { z } from "zod";

export const statusSchema = z.object({
  stack: z.string(),
  webhookUrl: z.string(),
  held: z.boolean(),
  pending: z.number(),
  customers: z.number(),
  subscriptions: z.number(),
  invoices: z.number(),
});

/** Stripe timestamps are unix seconds; the console reads epoch milliseconds. */
const at = z.number().transform((seconds) => seconds * 1000);

export const customerSchema = z.object({
  id: z.string(),
  created: at,
  email: z.string().nullable(),
  name: z.string().nullable(),
});
export type Customer = z.infer<typeof customerSchema>;

const itemSchema = z.object({
  quantity: z.number().optional(),
  price: z
    .object({
      id: z.string(),
      nickname: z.string().nullable(),
      lookup_key: z.string().nullable(),
    })
    .nullable(),
});

export const subscriptionSchema = z.object({
  id: z.string(),
  created: at,
  customer: z.string(),
  status: z.string(),
  cancel_at_period_end: z.boolean(),
  current_period_end: at,
  items: z.object({
    data: itemSchema
      .array()
      .nullable()
      .transform((v) => v ?? []),
  }),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  created: at,
  mode: z.string(),
  status: z.string(),
  payment_status: z.string(),
  customer: z.string().nullable(),
  subscription: z.string().nullable(),
  amount_total: z.number(),
  currency: z.string().nullable(),
});
export type Session = z.infer<typeof sessionSchema>;

export const invoiceSchema = z.object({
  id: z.string(),
  created: at,
  customer: z.string(),
  subscription: z.string().nullable(),
  status: z.string().nullable(),
  billing_reason: z.string(),
  total: z.number(),
  currency: z.string(),
  paid: z.boolean(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

const attemptSchema = z.object({
  at: at,
  status: z.number(),
  error: z.string().optional(),
  signed: z.string(),
});

export const eventSchema = z.object({
  event: z.object({ id: z.string(), type: z.string(), created: at }),
  attempts: attemptSchema
    .array()
    .nullable()
    .transform((v) => v ?? []),
});
export type EventRecord = z.infer<typeof eventSchema>;

export const eventsSchema = z.object({
  events: eventSchema
    .array()
    .nullable()
    .transform((v) => v ?? []),
  pending: z
    .string()
    .array()
    .nullable()
    .transform((v) => v ?? []),
  held: z.boolean(),
});

const list = <T extends z.ZodType>({ key, item }: { key: string; item: T }) =>
  z.object({ [key]: item.array().nullable() }).transform((body) => body[key] ?? []);

export const fetchStatus = () => simFetch({ path: "/_sim/api/status", schema: statusSchema });

export const fetchCustomers = () =>
  simFetch({
    path: "/_sim/api/customers",
    schema: list({ key: "customers", item: customerSchema }),
  });

export const fetchSubscriptions = () =>
  simFetch({
    path: "/_sim/api/subscriptions",
    schema: list({ key: "subscriptions", item: subscriptionSchema }),
  });

export const fetchSessions = () =>
  simFetch({ path: "/_sim/api/checkout", schema: list({ key: "sessions", item: sessionSchema }) });

export const fetchInvoices = () =>
  simFetch({
    path: "/_sim/api/invoices",
    schema: list({ key: "invoices", item: invoiceSchema }),
  });

export const fetchEvents = () => simFetch({ path: "/_sim/api/events", schema: eventsSchema });
