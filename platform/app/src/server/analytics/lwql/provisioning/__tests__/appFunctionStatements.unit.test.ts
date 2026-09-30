/**
 * The app functions' DDL, and the reconciliation that keeps their names honest.
 *
 * The statements are asserted against the *catalog* rather than against a
 * transcription of them: a test that spells out nine `CREATE OR REPLACE
 * FUNCTION` lines proves the transcription, and would go on passing after a
 * catalog entry changed its parameters. What is pinned instead is the rule —
 * the body projects the key arguments, and a pair becomes a tuple — plus the
 * one-to-one correspondence between what the catalog declares and what the
 * server is asked about.
 *
 * @see ../appFunctionStatements.ts
 * @see specs/lwql/app-functions.feature
 */
import { describe, expect, it } from "vitest";

import {
  type LangWatchQLAppFunctionDefinition,
  LWQL_APP_FUNCTION_CATALOG,
  lwqlAppFunctionKeyParameters,
  lwqlAppFunctionNames,
} from "../../appFunctions/catalog";
import {
  lwqlAppFunctionGrantAuditQuery,
  lwqlClickHouseSetupStatements,
} from "../accessModel";
import { renderLwqlAccessModelDdl } from "../accessModelDdl";
import { buildLwqlAccessModelDefinition } from "../accessModelDefinition";
import {
  LWQL_SQL_UDF_ORIGIN,
  lwqlAppFunctionBody,
  lwqlAppFunctionConflicts,
  lwqlAppFunctionCreateQuery,
  lwqlAppFunctionReconciliationQuery,
  lwqlAppFunctionStatement,
  lwqlAppFunctionStatements,
} from "../appFunctionStatements";
import type { PostgresNamedCollection } from "../postgresMapping";

const NAMES = {
  database: "lwql_test",
  restrictedUser: "lwql_test_reader",
  settingsProfile: "lwql_test_profile",
  keyMapTable: "api_key_tenants",
  tenantSetting: "custom_api_key_hash",
};

const NAMED_COLLECTION: PostgresNamedCollection = {
  collection: "lwql_postgres",
  host: "pg.internal",
  port: 5432,
  database: "lwql_test",
  user: "lwql_ro",
  password: "reader-secret",
};

const singleKey = (definition: LangWatchQLAppFunctionDefinition): boolean =>
  lwqlAppFunctionKeyParameters(definition).length === 1;

describe("given the app-function catalog", () => {
  describe("when the create statements are built", () => {
    /** @scenario "Every catalogued function has a create statement derived from its own signature" */
    it("emits one statement per declared function, in catalog order", () => {
      const statements = lwqlAppFunctionStatements();

      expect(statements).toHaveLength(LWQL_APP_FUNCTION_CATALOG.length);
      for (const [index, definition] of LWQL_APP_FUNCTION_CATALOG.entries()) {
        expect(statements[index]).toContain(
          `CREATE OR REPLACE FUNCTION ${definition.name} AS (`,
        );
      }
    });

    /** @scenario "Every catalogued function has a create statement derived from its own signature" */
    it("declares every parameter the signature names, in order", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        const parameters = definition.parameters
          .map((parameter) => parameter.name)
          .join(", ");
        expect(lwqlAppFunctionStatement(definition)).toContain(
          `(${parameters}) ->`,
        );
      }
    });

    /** @scenario "Every catalogued function has a create statement derived from its own signature" */
    it("projects the single key argument for a single-key function", () => {
      const single = LWQL_APP_FUNCTION_CATALOG.filter(singleKey);

      expect(single.length).toBeGreaterThan(0);
      for (const definition of single) {
        const [key] = lwqlAppFunctionKeyParameters(definition);
        expect(lwqlAppFunctionBody(definition)).toBe(key?.name);
      }
    });

    /** @scenario "Every catalogued function has a create statement derived from its own signature" */
    it("projects a tuple of both keys for a function whose key is a pair", () => {
      const paired = LWQL_APP_FUNCTION_CATALOG.filter(
        (definition) => !singleKey(definition),
      );

      // The control for the rule: if the catalog ever held no paired function,
      // the assertion below would pass vacuously and the tuple rule would be
      // unproven.
      expect(
        paired.length,
        "no function declares a pair of keys, so the tuple rule is untested",
      ).toBeGreaterThan(0);
      for (const definition of paired) {
        const keys = lwqlAppFunctionKeyParameters(definition).map(
          (parameter) => parameter.name,
        );
        expect(lwqlAppFunctionBody(definition)).toBe(
          `tuple(${keys.join(", ")})`,
        );
      }
    });

    it("refuses a declaration with no key parameter rather than emitting an empty body", () => {
      expect(() =>
        lwqlAppFunctionBody({
          name: "no_key",
          kind: "extraction",
          description: "",
          parameters: [
            {
              name: "opt",
              role: "option",
              type: "number",
              description: "",
            },
          ],
          keyKind: "trace",
          returns: "Nullable(String)",
          encoding: "text",
          gates: [],
          example: () => "",
        }),
      ).toThrow(/no key parameter/);
    });
  });

  describe("when the structural setup statements are built", () => {
    it("includes every function's create statement", () => {
      const statements = lwqlClickHouseSetupStatements({
        names: NAMES,
        sourceDatabase: NAMES.database,
      });

      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        const at = statements.findIndex((statement) =>
          statement.includes(`FUNCTION ${definition.name} AS (`),
        );
        expect(
          at,
          `${definition.name} has no create statement`,
        ).toBeGreaterThan(-1);
      }
    });

    it("grants the restricted identity nothing on any function", () => {
      // The access model is single-sourced from the definition now; assert the
      // grant set it renders never names a function.
      const statements = renderLwqlAccessModelDdl(
        buildLwqlAccessModelDefinition({
          names: NAMES,
          passwordSha256Hex: "a".repeat(64),
          namedCollection: NAMED_COLLECTION,
          sourceDatabase: NAMES.database,
        }),
      );

      for (const statement of statements) {
        if (!statement.startsWith("GRANT")) continue;
        expect(statement).not.toMatch(/FUNCTION/i);
      }
    });
  });

  describe("when the reconciliation query is built", () => {
    /** @scenario "The reconciliation query asks about exactly the declared names" */
    it("names every declared function and nothing else", () => {
      const query = lwqlAppFunctionReconciliationQuery();

      for (const name of lwqlAppFunctionNames()) {
        expect(query).toContain(`'${name}'`);
      }
      const quoted = [...query.matchAll(/'([^']+)'/g)].map((match) => match[1]);
      expect(quoted.sort()).toEqual([...lwqlAppFunctionNames()].sort());
    });

    it("reads the server's own function table, definitions included", () => {
      // `SHOW CREATE FUNCTION` does not exist, so `system.functions` is the
      // only place the stored body can be read from — and it has to be read,
      // or somebody else's UDF under one of these names is overwritten.
      const query = lwqlAppFunctionReconciliationQuery();

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
        create_query: lwqlAppFunctionCreateQuery(definition),
      }));

      expect(lwqlAppFunctionConflicts({ rows })).toEqual([]);
    });

    /** @scenario "A declared name held by somebody else's UDF is not overwritten" */
    it("reports our own origin with a body that is not ours", () => {
      const [definition] = LWQL_APP_FUNCTION_CATALOG;
      const name = definition?.name as string;

      expect(
        lwqlAppFunctionConflicts({
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
      // keeps `tuple(a, b)`. A comparison that read those as different would
      // report our own functions as somebody else's on one of the two.
      const definition = LWQL_APP_FUNCTION_CATALOG.find(
        (candidate) => candidate.name === "llm_messages_span",
      );
      if (!definition) throw new Error("llm_messages_span left the catalog");

      expect(
        lwqlAppFunctionConflicts({
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
        lwqlAppFunctionConflicts({
          rows: [
            {
              name: definition.name,
              origin: LWQL_SQL_UDF_ORIGIN,
              create_query:
                "CREATE FUNCTION conversation AS (thread_key) -> thread_key",
            },
          ],
        }),
      ).toEqual([]);
    });

    it("treats formatting alone as the same definition", () => {
      const [definition] = LWQL_APP_FUNCTION_CATALOG;
      if (!definition) throw new Error("the catalog is empty");

      expect(
        lwqlAppFunctionConflicts({
          rows: [
            {
              name: definition.name,
              origin: LWQL_SQL_UDF_ORIGIN,
              create_query: `  ${lwqlAppFunctionCreateQuery(definition).replace(
                / /g,
                "  ",
              )}  `,
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

      expect(lwqlAppFunctionConflicts({ rows })).toEqual([]);
    });

    it("reports no conflict before the first provisioning run", () => {
      expect(lwqlAppFunctionConflicts({ rows: [] })).toEqual([]);
    });

    /** @scenario "A declared name the server already owns is reported rather than accepted" */
    it("reports a declared name the server owns as something else", () => {
      const [first] = lwqlAppFunctionNames();

      expect(
        lwqlAppFunctionConflicts({
          rows: [{ name: first as string, origin: "System" }],
        }),
      ).toEqual([{ name: first, origin: "System", reason: "origin" }]);
    });

    it("ignores a server function this catalog never declared", () => {
      expect(
        lwqlAppFunctionConflicts({
          rows: [{ name: "length", origin: "System" }],
        }),
      ).toEqual([]);
    });
  });

  describe("when the grant audit is built", () => {
    it("asks only about the restricted identity's function grants", () => {
      const query = lwqlAppFunctionGrantAuditQuery({ names: NAMES });

      expect(query).toContain(`'${NAMES.restrictedUser}'`);
      expect(query).toContain("%FUNCTION%");
    });
  });
});
