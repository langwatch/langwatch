/**
 * The structural core of a trigger's stored filter tree, as persisted in the
 * `Trigger.filters` Json column: field name → values, nested up to two
 * levels (subkey → values, subkey → sub-subkey → values).
 *
 * The app narrows the key to its `FilterField` registry union
 * (`~/server/filters/types`); that narrow type is assignable to this one, so
 * repository reads speak this wide shape while authoring-side validation
 * keeps the closed field list.
 */
export type TriggerFilterValue =
  | string[]
  | Record<string, string[]>
  | Record<string, Record<string, string[]>>;

export type TriggerFilters = Partial<Record<string, TriggerFilterValue>>;
