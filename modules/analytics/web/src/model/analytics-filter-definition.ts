/**
 * What a filter field is CALLED, and what the address spells it.
 *
 * `FilterField` itself is `@langwatch/analytics-contract`'s — the enum is
 * published there because the ClickHouse translator needs it exhaustive. What
 * the contract does not carry is the reader-facing half: the name a sidebar
 * heading shows, the key the query string uses for it, whether the field takes
 * one value or many, and which other field has to be picked first.
 *
 * That half lives in `platform/app/src/server/filters/registry.ts`, under a
 * `~/server` path a browser package may not name, and roughly thirty platform
 * modules still read it. Deletes-only forbids repointing them, so the catalogue
 * beside this file is a family-local copy and the platform declaration stays
 * where it is. It is NOT a narrowed copy: the analytics filter sidebar renders
 * every field, so there is nothing to leave behind — the annotations family's
 * test for a safe vocabulary copy, failed the same way and taken anyway,
 * because this family is the vocabulary's own and the enum half is a repoint
 * onto the contract rather than a third declaration.
 *
 * `analytics-filter-catalogue.unit.test.ts` is what keeps the copy honest: it
 * asserts the catalogue answers for EVERY field the contract enumerates, so a
 * field added to the contract without an entry here fails rather than
 * disappearing out of the sidebar.
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
