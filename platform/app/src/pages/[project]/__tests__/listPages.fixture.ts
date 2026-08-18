/**
 * Rows for the list-page suites (`automations.listPages.*.integration.test.tsx`):
 * one of everything the unified table can hold — a graph watch, a schedule, a
 * trace-filter automation, and a bot-delivery Slack automation. Pure data, so
 * both suites read the same project without sharing mock state.
 */

import { TriggerKind } from "~/generated/prisma/client";

export const graphTrigger = {
  id: "alert-1",
  name: "Cost spike",
  active: true,
  pausedReason: null,
  customGraphId: "graph-1",
  customGraph: { name: "Cost graph" },
  triggerKind: TriggerKind.ALERT,
  action: "SEND_EMAIL",
  actionParams: {
    seriesName: "cost",
    operator: "gt",
    threshold: 10,
    timePeriod: 60,
    members: ["a@b.com"],
  },
  checks: [],
  filterQuery: null,
  filters: "{}",
};

export const scheduleTrigger = {
  id: "schedule-1",
  name: "Weekly digest",
  active: true,
  pausedReason: null,
  customGraphId: null,
  customGraph: null,
  triggerKind: TriggerKind.REPORT,
  action: "SEND_EMAIL",
  actionParams: {
    source: { kind: "traceQuery", topN: 5 },
    schedule: { cron: "0 9 * * 1", timezone: "UTC" },
    members: ["a@b.com"],
  },
  checks: [],
  filterQuery: null,
  filters: "{}",
};

export const filterTrigger = {
  id: "automation-1",
  name: "Flag failures",
  active: true,
  pausedReason: null,
  customGraphId: null,
  customGraph: null,
  triggerKind: TriggerKind.AUTOMATION,
  action: "SEND_SLACK_MESSAGE",
  actionParams: { slackWebhook: "https://hooks.slack.example/x" },
  checks: [],
  filterQuery: "status:error",
  filters: "{}",
};

export const botSlackTrigger = {
  id: "automation-2",
  name: "Errors to #ops",
  active: true,
  pausedReason: null,
  customGraphId: null,
  customGraph: null,
  triggerKind: TriggerKind.AUTOMATION,
  action: "SEND_SLACK_MESSAGE",
  actionParams: { slackDelivery: "bot", slackChannelId: "C0999999" },
  checks: [],
  filterQuery: "status:error",
  filters: "{}",
};

export const allTriggers = [
  graphTrigger,
  scheduleTrigger,
  filterTrigger,
  botSlackTrigger,
];
