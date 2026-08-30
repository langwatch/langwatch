/**
 * @vitest-environment node
 *
 * `scenarioParameterDefinitionSchema` is shared by the scenarios and suites
 * REST families. Before this guard, another module could import
 * `server/scenarios/parameters.ts` before `zod-openapi/extend` had run, so the
 * schema objects were constructed unpatched and a later OpenAPI conversion
 * dropped the descriptions on `defaultValue` and `secret`.
 *
 * Drive the real module in fresh processes so module cache and import order are
 * both real, and pin the two orders that matter.
 *
 * @see specs/api-reference/scenario-parameter-openapi-descriptions.feature
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "../../../..");
const TSX = path.join(APP_ROOT, "node_modules", ".bin", "tsx");
const TSCONFIG = path.join(APP_ROOT, "tsconfig.json");
const DEFAULT_VALUE_DESCRIPTION =
  "The value the run uses when it supplies none. A secret parameter cannot carry one.";
const SECRET_DESCRIPTION =
  "Whether the value is a credential, supplied when the run starts and delivered to the target as secrets.NAME. A secret parameter is rejected when it also carries defaultValue.";

let scratch: string;

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function runProbe(order: "extend-first" | "schema-first"): {
  status: number | null;
  stderr: string;
  stdout: string;
  schema: {
    defaultValue?: { description?: string };
    secret?: { description?: string };
  } | null;
} {
  scratch = mkdtempSync(path.join(APP_ROOT, ".parameters-openapi-"));
  const probe = path.join(scratch, "probe.ts");
  writeFileSync(
    probe,
    `import { createSchema } from "zod-openapi";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appRoot = ${JSON.stringify(APP_ROOT)};
const order = process.argv[2];

async function importFromApp(rel) {
  return import(pathToFileURL(path.join(appRoot, rel)).href);
}

async function main() {
  if (order === "extend-first") {
    await import("zod-openapi/extend");
  }
  const { scenarioParameterDefinitionSchema } = await importFromApp(
    "src/server/scenarios/parameters.ts",
  );
  if (order === "schema-first") {
    await import("zod-openapi/extend");
  }
  const { schema } = createSchema(scenarioParameterDefinitionSchema, {
    schemaType: "input",
  });
  console.log(
    JSON.stringify({
      defaultValue: schema?.properties?.defaultValue ?? null,
      secret: schema?.properties?.secret ?? null,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
    "utf8",
  );

  const result = spawnSync(TSX, ["--tsconfig", TSCONFIG, probe, order], {
    cwd: APP_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    schema: result.stdout
      ? (JSON.parse(result.stdout) as {
          defaultValue?: { description?: string };
          secret?: { description?: string };
        })
      : null,
  };
}

describe("scenario parameter OpenAPI descriptions", () => {
  /** @scenario "Loading zod-openapi before the schema keeps the descriptions" */
  it("keeps both descriptions when the patch loads first", () => {
    const result = runProbe("extend-first");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toBe("");
    expect(result.schema?.defaultValue?.description).toBe(
      DEFAULT_VALUE_DESCRIPTION,
    );
    expect(result.schema?.secret?.description).toBe(SECRET_DESCRIPTION);
  });

  /** @scenario "Another module may import the schema before the patch and the descriptions still survive" */
  it("keeps both descriptions even when another module loads the schema first", () => {
    const result = runProbe("schema-first");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toBe("");
    expect(result.schema?.defaultValue?.description).toBe(
      DEFAULT_VALUE_DESCRIPTION,
    );
    expect(result.schema?.secret?.description).toBe(SECRET_DESCRIPTION);
  });
});
