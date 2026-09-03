/**
 * The configuration one AI-tool tile carries, by the type of tile it is.
 *
 * The read hands `config` over as an untyped record — the catalogue stores one
 * JSON blob per tile and the type beside it is what says how to read it — so
 * every tile narrows it at the point it renders. This is the narrowing, taken
 * from the contract's own discriminated union rather than restated: a field
 * added to a tile's configuration on the authoring side reaches the portal
 * without anything here changing.
 */

import type { AiToolConfigEnvelope } from "@langwatch/enterprise-governance-contract";

/** The `config` shape a tile of the given type stores. */
export type AiToolConfigOf<TType extends AiToolConfigEnvelope["type"]> = Extract<
  AiToolConfigEnvelope,
  { type: TType }
>["config"];
