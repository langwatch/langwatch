/**
 * Package-owned copies of the Prisma enums the automation domain speaks.
 * This package is consumed by surfaces with no database (CLI, MCP server,
 * web), so it cannot import `@prisma/client`. The values are plain string
 * literals identical to the Prisma enums; the app pins the two in lockstep
 * with a parity test (`prismaEnumParity.unit.test.ts`) that fails on any
 * drift in either direction.
 */

export const TriggerAction = {
  SEND_EMAIL: "SEND_EMAIL",
  ADD_TO_DATASET: "ADD_TO_DATASET",
  ADD_TO_ANNOTATION_QUEUE: "ADD_TO_ANNOTATION_QUEUE",
  SEND_SLACK_MESSAGE: "SEND_SLACK_MESSAGE",
  SEND_WEBHOOK: "SEND_WEBHOOK",
} as const;
export type TriggerAction = (typeof TriggerAction)[keyof typeof TriggerAction];

export const AlertType = {
  CRITICAL: "CRITICAL",
  WARNING: "WARNING",
  INFO: "INFO",
} as const;
export type AlertType = (typeof AlertType)[keyof typeof AlertType];

export const TriggerKind = {
  AUTOMATION: "AUTOMATION",
  ALERT: "ALERT",
  REPORT: "REPORT",
} as const;
export type TriggerKind = (typeof TriggerKind)[keyof typeof TriggerKind];
