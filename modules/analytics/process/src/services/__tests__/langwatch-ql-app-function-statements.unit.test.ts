/**
 * The app functions' DDL and its reconciliation, asserted against the catalog
 * rather than a transcription: the rule is what is pinned — the body projects
 * the key arguments. @see specs/lwql/app-functions.feature
 */

import { describe, expect, it } from "vitest";

import {
  LWQL_APP_FUNCTION_CATALOG,
  lwqlAppFunctionKeyParameters,
  lwqlAppFunctionNames,
} from "../../rules/langwatch-ql-app-function-catalog.rules.ts";
import type { LangWatchQLAppFunctionDefinition } from "../../rules/langwatch-ql-app-function-shapes.rules.ts";
import { LangWatchQLAccessAuditService } from "../langwatch-ql-access-audit.service.ts";
import { LangWatchQLAccessModelService } from "../langwatch-ql-access-model.service.ts";
import {
  LWQL_SQL_UDF_ORIGIN,
  LangWatchQLAppFunctionStatementsService,
} from "../langwatch-ql-app-function-statements.service.ts";

const statements = LangWatchQLAppFunctionStatementsService.create();
const accessModel = LangWatchQLAccessModelService.create();
const accessAudit = LangWatchQLAccessAuditService.create();

const NAMES = {
  database: "lwql_test",
  restrictedUser: "lwql_test_reader",
  settingsProfile: "lwql_test_profile",
  keyMapTable: "api_key_tenants",
  tenantSetting: "custom_api_key_hash",
};

const singleKey = (definition: LangWatchQLAppFunctionDefinition): boolean =>
  lwqlAppFunctionKeyParameters(definition).length === 1;

describe("given the app-function catalog", () => {
  describe("when the create statements are built", () => {
    /** @scenario "Every catalogued function has a create statement derived from its own signature" */
    it("emits one statement per declared function, in catalog order", () => {
      const built = statements.functionStatements();

      expect(built).toHaveLength(LWQL_APP_FUNCTION_CATALOG.length);
      for (const [index, definition] of LWQL_APP_FUNCTION_CATALOG.entries()) {
        expect(built[index]).toContain(`CREATE OR REPLACE FUNCTION ${definition.name} AS (`);
      }
    });

    /** @scenario "Every catalogued function has a create statement derived from its own signature" */
    it("declares every parameter the signature names, in order", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        const parameters = definition.parameters.map((parameter) => parameter.name).join(", ");
        expect(statements.functionStatement(definition)).toContain(`(${parameters}) ->`);
      }
    });

    /** @scenario "Every catalogued function has a create statement derived from its own signature" */
    it("projects the single key argument for a single-key function", () => {
      const single = LWQL_APP_FUNCTION_CATALOG.filter(singleKey);

      expect(single.length).toBeGreaterThan(0);
      for (const definition of single) {
        const [key] = lwqlAppFunctionKeyParameters(definition);
        expect(statements.functionBody(definition)).toBe(key?.name);
      }
    });

    /** @scenario "Every catalogued function has a create statement derived from its own signature" */
    it("projects a tuple of both keys for a function whose key is a pair", () => {
      const paired = LWQL_APP_FUNCTION_CATALOG.filter((definition) => !singleKey(definition));

      // The control for the rule: with no paired function the assertion below
      // would pass vacuously and the tuple rule would be unproven.
      expect(
        paired.length,
        "no function declares a pair of keys, so the tuple rule is untested",
      ).toBeGreaterThan(0);
      for (const definition of paired) {
        const keys = lwqlAppFunctionKeyParameters(definition).map((parameter) => parameter.name);
        expect(statements.functionBody(definition)).toBe(`tuple(${keys.join(", ")})`);
      }
    });

    it("refuses a declaration with no key parameter rather than emitting an empty body", () => {
      expect(() =>
        statements.functionBody({
          name: "no_key",
          kind: "extraction",
          description: "",
          parameters: [{ name: "opt", role: "option", type: "number", description: "" }],
          keyKind: "trace",
          returns: "Nullable(String)",
          encoding: "text",
          gates: [],
          example: () => "",
        }),
      ).toThrow(/no key parameter/);
    });
  });

  describe("when the access model's setup statements are built", () => {
    it("includes every function's DDL before the first grant", () => {
      const built = accessModel.setupStatements({
        names: NAMES,
        password: "secret",
        lwqlTables: [],
      });
      const firstGrant = built.findIndex((statement) => statement.startsWith("GRANT"));

      expect(firstGrant).toBeGreaterThan(0);
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        const at = built.findIndex((statement) =>
          statement.includes(`FUNCTION ${definition.name} AS (`),
        );
        expect(at, `${definition.name} has no create statement`).toBeGreaterThan(-1);
        expect(at).toBeLessThan(firstGrant);
      }
    });

    it("grants the restricted identity nothing on any function", () => {
      const built = accessModel.setupStatements({
        names: NAMES,
        password: "secret",
        lwqlTables: [],
      });

      for (const statement of built) {
        if (!statement.startsWith("GRANT")) continue;
        expect(statement).not.toMatch(/FUNCTION/i);
      }
    });

    it("leaves the functions out where a create would land on one replica of several", () => {
      const built = accessModel.setupStatements({
        names: NAMES,
        password: "secret",
        lwqlTables: [],
        includeAppFunctions: false,
      });

      expect(built.some((statement) => statement.includes("CREATE OR REPLACE FUNCTION"))).toBe(
        false,
      );
    });
  });

  describe("when the reconciliation query is built", () => {
    /** @scenario "The reconciliation query asks about exactly the declared names" */
    it("names every declared function and nothing else", () => {
      const query = statements.reconciliationQuery();

      for (const name of lwqlAppFunctionNames()) {
        expect(query).toContain(`'${name}'`);
      }
      const byName = (left = "", right = "") => left.localeCompare(right);
      const quoted = [...query.matchAll(/'([^']+)'/g)].map((match) => match[1]);
      expect(quoted.toSorted(byName)).toEqual(lwqlAppFunctionNames().toSorted(byName));
    });

    it("reads the server's own function table, definitions included", () => {
      // `SHOW CREATE FUNCTION` does not exist, so `system.functions` is the
      // only place the stored body can be read from — and it has to be read,
      // or somebody else's UDF under one of these names is overwritten.
      const query = statements.reconciliationQuery();

      expect(query).toContain("system.functions");
      expect(query).toContain("create_query");
    });
  });

  describe("when the server's answer is reconciled", () => {
    /** @scenario "Provisioning the functions twice leaves the same definitions" */
    it("reports no conflict for functions the server holds as our own UDFs", () => {
      const rows = LWQL_APP_FUNCTION_CATALOG.map((definition) => ({
        name: definition.name,
        origin: LWQL_SQL_UDF_ORIGIN,
        create_query: statements.storedCreateQuery(definition),
      }));

      expect(statements.findConflicts({ rows })).toEqual([]);
    });

    /** @scenario "A declared name held by somebody else's UDF is not overwritten" */
    it("reports our own origin with a body that is not ours", () => {
      const [definition] = LWQL_APP_FUNCTION_CATALOG;
      if (!definition) throw new Error("the catalog is empty");
      const { name } = definition;

      expect(
        statements.findConflicts({
          rows: [
            {
              name,
              origin: LWQL_SQL_UDF_ORIGIN,
              create_query: `CREATE FUNCTION ${name} AS x -> x * 2`,
            },
          ],
        }),
      ).toEqual([
        {
          name,
          origin: LWQL_SQL_UDF_ORIGIN,
          reason: "definition",
          createQuery: `CREATE FUNCTION ${name} AS x -> x * 2`,
        },
      ]);
    });

    it("treats a tuple body and a parenthesised one as the same definition", () => {
      // 25.8 stores the pair body as `(a, b)`; the version the harness runs
      // keeps `tuple(a, b)`. A comparison reading those as different would
      // report our own functions as somebody else's on one of the two.
      const definition = LWQL_APP_FUNCTION_CATALOG.find(
        (candidate) => candidate.name === "llm_messages_span",
      );
      if (!definition) throw new Error("llm_messages_span left the catalog");

      expect(
        statements.findConflicts({
          rows: [
            {
              name: definition.name,
              origin: LWQL_SQL_UDF_ORIGIN,
              create_query:
                "CREATE FUNCTION llm_messages_span AS (trace_id, span_id) -> tuple(trace_id, span_id)",
            },
          ],
        }),
      ).toEqual([]);
    });

    it("treats a single parameter with and without parentheses as the same", () => {
      const definition = LWQL_APP_FUNCTION_CATALOG.find(
        (candidate) => candidate.name === "conversation",
      );
      if (!definition) throw new Error("conversation left the catalog");

      expect(
        statements.findConflicts({
          rows: [
            {
              name: definition.name,
              origin: LWQL_SQL_UDF_ORIGIN,
              create_query: "CREATE FUNCTION conversation AS (thread_key) -> thread_key",
            },
          ],
        }),
      ).toEqual([]);
    });

    it("treats formatting alone as the same definition", () => {
      const [definition] = LWQL_APP_FUNCTION_CATALOG;
      if (!definition) throw new Error("the catalog is empty");

      expect(
        statements.findConflicts({
          rows: [
            {
              name: definition.name,
              origin: LWQL_SQL_UDF_ORIGIN,
              create_query: `  ${statements.storedCreateQuery(definition).replace(/ /g, "  ")}  `,
            },
          ],
        }),
      ).toEqual([]);
    });

    it("accepts a server too old to report a definition rather than refusing every run", () => {
      const rows = LWQL_APP_FUNCTION_CATALOG.map((definition) => ({
        name: definition.name,
        origin: LWQL_SQL_UDF_ORIGIN,
      }));

      expect(statements.findConflicts({ rows })).toEqual([]);
    });

    it("reports no conflict before the first provisioning run", () => {
      expect(statements.findConflicts({ rows: [] })).toEqual([]);
    });

    /** @scenario "A declared name the server already owns is reported rather than accepted" */
    it("reports a declared name the server owns as something else", () => {
      const [first] = lwqlAppFunctionNames();
      if (first === undefined) throw new Error("the catalog is empty");

      expect(statements.findConflicts({ rows: [{ name: first, origin: "System" }] })).toEqual([
        { name: first, origin: "System", reason: "origin" },
      ]);
    });

    it("ignores a server function this catalog never declared", () => {
      expect(statements.findConflicts({ rows: [{ name: "length", origin: "System" }] })).toEqual(
        [],
      );
    });
  });

  describe("when the grant audit is built", () => {
    it("asks only about the restricted identity's function grants", () => {
      const query = accessAudit.appFunctionGrantAuditQuery({ names: NAMES });

      expect(query).toContain(`'${NAMES.restrictedUser}'`);
      expect(query).toContain("%FUNCTION%");
    });
  });
});
