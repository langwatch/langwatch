/**
 * The configuration one AI-tool tile carries, by the type of tile it is. The read hands
 * `config` over as an untyped record — the catalogue stores one JSON blob per tile and the type
 * beside it is what says how to read it — so every tile narrows it at the point it renders.
 */

import type { AiToolConfigEnvelope } from "./ai-tool-catalog";

/** The `config` shape a tile of the given type stores. */
export type AiToolConfigOf<TType extends AiToolConfigEnvelope["type"]> = Extract<
  AiToolConfigEnvelope,
  { type: TType }
>["config"];
