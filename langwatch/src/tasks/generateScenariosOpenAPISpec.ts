/**
 * Regenerates only the `/api/scenarios` half of the checked-in OpenAPI spec.
 *
 * `generateOpenAPISpec` is the real task and should be preferred. It currently
 * cannot run: it dies at the prompts app with "the schema … needs to be
 * registered because it's circularly referenced", which predates this branch
 * and has nothing to do with scenarios. That left the checked-in spec — and
 * therefore the generated SDK/CLI types — unable to describe the red-team
 * fields, so a TypeScript consumer could send them but never discover them.
 *
 * This does for one app exactly what the full task does for all of them:
 * generate, then replace those paths wholesale (they come from the app, so
 * merging stale keys back in would be wrong). Everything else in the file is
 * left untouched.
 *
 * Delete this once the prompts schema is fixed and the full task runs again.
 */
import fs from "fs";
import { generateSpecs } from "hono-openapi";
import path from "path";
import currentSpec from "../app/api/openapiLangWatch.json";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";

export default async function execute() {
  console.log("Building scenarios spec...");
  const scenariosSpec = (await generateSpecs(scenariosApp)) as {
    paths?: Record<string, unknown>;
  };

  const spec = currentSpec as unknown as {
    paths: Record<string, unknown>;
  };

  const regenerated: string[] = [];
  for (const [route, definition] of Object.entries(scenariosSpec.paths ?? {})) {
    spec.paths[route] = definition;
    regenerated.push(route);
  }

  if (regenerated.length === 0) {
    throw new Error(
      "The scenarios app produced no paths — refusing to write a spec that would silently drop them.",
    );
  }

  fs.writeFileSync(
    path.join(__dirname, "../app/api/openapiLangWatch.json"),
    JSON.stringify(spec, null, 2),
  );

  console.log(`Regenerated ${regenerated.length} scenario paths:`);
  for (const route of regenerated) console.log(`  ${route}`);
}
