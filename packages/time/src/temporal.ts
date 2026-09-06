/**
 * The Temporal this package computes with: the runtime's own when it has one,
 * the polyfill otherwise. Every module here imports Temporal from this file so
 * a native implementation is used the moment a runtime provides it.
 */

import { Temporal as PolyfilledTemporal } from "temporal-polyfill";

type TemporalNamespace = typeof PolyfilledTemporal;

const scope = globalThis as { Temporal?: TemporalNamespace };

export const Temporal: TemporalNamespace = scope.Temporal ?? PolyfilledTemporal;

export type ZonedDateTime = PolyfilledTemporal.ZonedDateTime;
export type PlainDateTime = PolyfilledTemporal.PlainDateTime;
