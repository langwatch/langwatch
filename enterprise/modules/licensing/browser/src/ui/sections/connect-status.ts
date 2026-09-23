import type { ConnectStatus } from "@langwatch/enterprise-licensing-contract";

/** The state of an install where Connect is switched on for the deployment. */
export type ConnectEnabledStatus = Extract<ConnectStatus, { deployment: "on" }>;
