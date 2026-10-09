/**
 * @langwatch/identity-process — the server-side runtime of the identity
 * platform (ADR-101, ADR-115): guards, services and crypto over the app's
 * heads/ledger/records ports. The pure half is `@langwatch/identity-contract`.
 */
export { identityProcessModule } from "./identity.module.ts";
export { IdentityJitDisabledError, IdentityLinkProposedError } from "@langwatch/identity-contract";
