// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The OTTL validate/transform calls governance makes against the aigateway's
 * `/internal/*` surface.
 *
 * This module owns none of the OTTL runtime — it is a message to a running Go
 * service and back, not a row this module persists, so it is a channel rather
 * than a repository. `GovernanceOttlGateway` is already the portable type the
 * installer and the ingestion services are built against
 * (`@langwatch/enterprise-governance-contract`), so this file re-exports it
 * rather than redeclaring an equivalent interface: `http/` and `memory/` both
 * implement it from here, the way every other channel's tiers import their
 * interface from the file beside them.
 */
export {
  GovernanceOttlGateway,
  OttlGatewayUnavailableError,
  ottlTransformInputSchema,
} from "@langwatch/enterprise-governance-contract";
export type {
  OttlEncoding,
  OttlTransformInput,
  OttlTransformResult,
  OttlValidationError,
  OttlValidationResult,
} from "@langwatch/enterprise-governance-contract";
