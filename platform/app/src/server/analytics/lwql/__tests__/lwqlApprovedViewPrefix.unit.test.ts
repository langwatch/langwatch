/**
 * The naming contract between the approved views and the grants that reach them.
 *
 * The reader role's `SELECT` grants are not provisioned from this catalog. The
 * infrastructure bootstrap selects the relations to grant by matching their
 * names against a prefix, so an approved view named outside it is created and
 * then granted to nobody. That failure is silent in the shape that matters: the
 * view exists, the ClickHouse PostgreSQL-engine table over it resolves, and the
 * query returns no rows rather than an error a caller could act on.
 *
 * Nothing else in this repository can catch it. Every other suite reads the
 * approved-view names out of this same catalog, so a renamed view moves the
 * expectation with it and stays green. The prefix is written out literally here
 * for that reason: this guard has to be able to disagree with the catalog, and
 * one that read the name from the catalog never could.
 *
 * @see ../views.ts — the statements under test
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import { lwqlPostgresViews } from "../catalog/types";
import {
  lwqlApprovedPostgresViewNames,
  lwqlPostgresApprovedViewStatements,
} from "../views";

/**
 * The prefix the infrastructure bootstrap's grant predicate matches
 * (`viewname LIKE 'lwql\_%'`). Held here as a literal because the contract is
 * with a repository this one cannot import.
 */
const GRANTED_PREFIX = "lwql_";

const SCHEMA = "public";

/** Relation a `CREATE OR REPLACE VIEW` statement actually creates. */
function createdRelation(statement: string): string {
  const match = /^CREATE OR REPLACE VIEW "[^"]+"\."([^"]+)"/.exec(statement);
  if (!match?.[1]) {
    throw new Error(`not an approved-view statement: ${statement.slice(0, 80)}`);
  }
  return match[1];
}

describe("given the LangWatchQL approved PostgreSQL views", () => {
  describe("when the catalog's mappings are read", () => {
    /** @scenario "Every approved view is named under the prefix the reader's grants match" */
    it("names every approved view under the prefix the grants match", () => {
      const mapped = lwqlPostgresViews(LWQL_VIEW_CATALOG);
      expect(
        mapped.length,
        "no dataset is PostgreSQL-resident — this case is inspecting nothing",
      ).toBeGreaterThan(0);
      for (const view of mapped) {
        expect(
          view.postgres.approvedView,
          `${view.name} maps to a view the reader is never granted`,
        ).toMatch(new RegExp(`^${GRANTED_PREFIX}`));
      }
    });

    /** @scenario "Every approved view is named under the prefix the reader's grants match" */
    it("carries the prefix through to the names the grants are built from", () => {
      const granted = lwqlApprovedPostgresViewNames();
      expect(granted.length).toBe(lwqlPostgresViews(LWQL_VIEW_CATALOG).length);
      for (const name of granted) {
        expect(name.startsWith(GRANTED_PREFIX), `${name} is ungranted`).toBe(true);
      }
    });
  });

  describe("when the provisioner's statements are read", () => {
    /** @scenario "Every approved view is named under the prefix the reader's grants match" */
    it("creates every view under that prefix, not merely declares one", () => {
      const statements = lwqlPostgresApprovedViewStatements({ schema: SCHEMA });
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        const relation = createdRelation(statement);
        expect(
          relation.startsWith(GRANTED_PREFIX),
          `provisioning creates "${relation}", which no grant reaches`,
        ).toBe(true);
      }
    });

    /**
     * The catalog is the only input that decides those names, so a check that
     * cannot fail on a bad one proves nothing about the shipped catalog. This
     * runs the same predicate over a mapping named the way the pre-rename
     * catalog named them, and requires it to be rejected.
     */
    /** @scenario "Every approved view is named under the prefix the reader's grants match" */
    it("rejects a mapping named the way the grants would miss", () => {
      const [resident] = lwqlPostgresViews(LWQL_VIEW_CATALOG);
      if (!resident) throw new Error("catalog has no PostgreSQL-resident view");
      const renamed = {
        ...resident,
        postgres: { ...resident.postgres, approvedView: "governed_traces" },
      };
      const [statement] = lwqlPostgresApprovedViewStatements({
        schema: SCHEMA,
        views: [renamed],
      });
      expect(statement).toBeDefined();
      expect(createdRelation(statement!).startsWith(GRANTED_PREFIX)).toBe(false);
    });
  });
});
