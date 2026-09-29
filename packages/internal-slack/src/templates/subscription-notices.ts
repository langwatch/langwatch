import { z } from "zod";

import { bold, code, count, defineNotice, moment } from "../notice.ts";

const ADMIN_BUTTON = "Open org in admin";

export const subscriptionProspectiveNotice = defineNotice({
  id: "subscription-prospective",
  title: "Prospective subscription interest",
  sentWhen:
    "Somebody in an organization starts upgrading to a paid plan; to the subscriptions channel.",
  schema: z.object({
    organizationName: z.string(),
    plan: z.string(),
    customerName: z.string().nullish(),
    note: z.string().nullish(),
    adminUrl: z.url(),
  }),
  compose: (props) => ({
    tone: "lead",
    title: "Prospective subscription interest",
    summary: `Triggered by ${props.customerName ?? "a team member"}`,
    fields: [
      { label: "Organization", value: props.organizationName },
      { label: "Plan", value: props.plan },
      { label: "Customer", value: props.customerName ?? "Unknown" },
    ],
    ...(props.note ? { note: props.note } : {}),
    actions: [{ label: ADMIN_BUTTON, url: props.adminUrl, primary: true }],
  }),
  fixtures: {
    "with a note": {
      organizationName: "Acme Robotics",
      plan: "GROWTH_SEAT_EVENT",
      customerName: "Morgan Ellis",
      note: "Asked about annual billing for 40 seats.",
      adminUrl: "https://app.langwatch.ai/admin#/organizations/organization_acme",
    },
    "from an unnamed member": {
      organizationName: "Acme Robotics",
      plan: "LAUNCH",
      adminUrl: "https://app.langwatch.ai/admin#/organizations/organization_acme",
    },
  },
});

export const subscriptionActivatedNotice = defineNotice({
  id: "subscription-activated",
  title: "Subscription activated",
  sentWhen: "A paid subscription becomes active; to the subscriptions channel.",
  schema: z.object({
    organizationName: z.string(),
    plan: z.string(),
    subscriptionId: z.string(),
    startedAt: z.number().int().nullish().describe("Epoch milliseconds; absent means now"),
    seats: z.number().nullish(),
    tracesPerMonth: z.number().nullish(),
    adminUrl: z.url(),
  }),
  compose: (props) => ({
    tone: "win",
    title: "Subscription activated",
    summary: [bold(props.organizationName), " is live on ", bold(props.plan), "."],
    fields: [
      { label: "Subscription ID", value: code(props.subscriptionId) },
      { label: "Start date", value: props.startedAt ? moment(props.startedAt) : "Now" },
      { label: "Seats", value: count(props.seats) },
      { label: "Traces/month", value: count(props.tracesPerMonth) },
    ],
    actions: [{ label: ADMIN_BUTTON, url: props.adminUrl }],
  }),
  fixtures: {
    "a seat plan": {
      organizationName: "Acme Robotics",
      plan: "GROWTH_SEAT_EVENT",
      subscriptionId: "subscription_2mNf0QJ7sW1x",
      startedAt: 1_790_000_000_000,
      seats: 12,
      tracesPerMonth: 200_000,
      adminUrl: "https://app.langwatch.ai/admin#/organizations/organization_acme",
    },
    "activated just now": {
      organizationName: "Acme Robotics",
      plan: "LAUNCH",
      subscriptionId: "subscription_2mNf0QJ7sW1x",
      adminUrl: "https://app.langwatch.ai/admin#/organizations/organization_acme",
    },
  },
});

export const subscriptionCancelledNotice = defineNotice({
  id: "subscription-cancelled",
  title: "Subscription cancelled",
  sentWhen: "A paid subscription is cancelled; to the subscriptions channel.",
  schema: z.object({
    organizationName: z.string(),
    plan: z.string(),
    subscriptionId: z.string(),
    cancelledAt: z.number().int().nullish().describe("Epoch milliseconds; absent means now"),
    adminUrl: z.url(),
  }),
  compose: (props) => ({
    tone: "loss",
    title: "Subscription cancelled",
    summary: [bold(props.organizationName), " has cancelled ", bold(props.plan), "."],
    fields: [
      { label: "Subscription ID", value: code(props.subscriptionId) },
      {
        label: "Cancellation date",
        value: props.cancelledAt ? moment(props.cancelledAt) : "Now",
      },
    ],
    actions: [{ label: ADMIN_BUTTON, url: props.adminUrl }],
  }),
  fixtures: {
    cancelled: {
      organizationName: "Acme Robotics",
      plan: "GROWTH_SEAT_EVENT",
      subscriptionId: "subscription_2mNf0QJ7sW1x",
      cancelledAt: 1_790_000_000_000,
      adminUrl: "https://app.langwatch.ai/admin#/organizations/organization_acme",
    },
  },
});
