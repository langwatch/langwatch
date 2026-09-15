/**
 * What a filter field is called, and what the address spells it — a
 * family-local copy of `platform/app`'s registry (unreachable from here;
 * deletes-only forbids repointing ~30 readers); kept honest by its own test.
 */

export type { FilterField } from "@langwatch/analytics-contract";
import type { FilterField } from "@langwatch/analytics-contract";

export type FilterDefinition = {
  name: string;
  urlKey: string;
  single?: boolean;
  type?: "numeric";
  requiresKey?: {
    filter: FilterField;
  };
  requiresSubkey?: {
    filter: FilterField;
  };
};
