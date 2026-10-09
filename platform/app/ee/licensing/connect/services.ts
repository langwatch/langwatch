/**
 * The hosted services a license can be entitled to, named the way the license
 * registry, the install's opt-in and the hosted routes all name them.
 */
export const CONNECT_SERVICES = ["instant_evals", "managed_models"] as const;
export type ConnectService = (typeof CONNECT_SERVICES)[number];
