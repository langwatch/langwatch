/**
 * No entry point migrates before serving: the worker runs `pnpm task upgrade`; only
 * the serialised Helm Job and the local launchers run the preparation script.
 * Spec: specs/upgrade/entry-points.feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function readFromRoot(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");
}

const uncommented = (text: string) =>
  text.split("\n").filter((line) => !/^\s*(#|\/\/|\*|\/\*)/.test(line));
const PREPARE = "start:prepare:db";
const OLD_TASKS = /prisma-migrate|clickhouse-migrate|lwql-provision|prisma migrate deploy/;
const scripts: Record<string, string> = JSON.parse(readFromRoot("apps/api/package.json")).scripts;

/** The service block of a compose file: its lines up to the next top-level service. */
function composeService({ text, name }: { text: string; name: string }): string {
  const lines = text.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("the entry points", () => {
  describe("given the api and the worker", () => {
    /** @scenario "The api and the worker start without migrating" */
    it("start only their own process", () => {
      for (const app of ["api", "worker"]) {
        const start = JSON.parse(readFromRoot(`apps/${app}/package.json`)).scripts.start;
        expect(start).toMatch(/^node --experimental-transform-types .*src\/main\.ts$/);
        expect(start).not.toMatch(/start:prepare|task |migrate/);
      }
    });
  });

  describe("given the one preparation script", () => {
    /** @scenario "The one preparation script runs the upgrade and nothing else" */
    it("runs upgrade alone, with no system-migrations pass behind it", () => {
      expect(scripts[PREPARE]).toBe("cd ../tasks && pnpm --silent task upgrade");
    });
  });

  describe("given the chart's pre-roll Job", () => {
    /** @scenario "The Helm pre-roll Job renders only when upgrades are serialised" */
    it("renders only with serializeUpgrades active, as a pre-upgrade hook running the preparation script", () => {
      const job = readFromRoot("charts/langwatch/templates/app/migrate-pre-roll-job.yaml");
      const lines = uncommented(job.replace(/\{\{\/\*[\s\S]*?\*\/\}\}/g, ""));

      expect(lines).toContain(
        '{{- if and $preRoll (eq (include "langwatch.storedObjects.serializeUpgradesActive" .) "true") }}',
      );
      expect(lines).toContain("    helm.sh/hook: pre-upgrade");
      expect(lines).toContain(`          args: ["-s", "run", "${PREPARE}"]`);
      expect(lines).toContain("          workingDir: /app/apps/api");
      expect(lines.filter((line) => /pre-install|pre-rollback/.test(line))).toEqual([]);
    });

    /** @scenario "A Helm upgrade without serialised upgrades renders no pre-roll Job; the new workers run the upgrade" */
    it("treats serialised upgrades as off when the knob is off or a dataplane is configured", () => {
      const helpers = uncommented(readFromRoot("charts/langwatch/templates/_helpers.tpl"));

      expect(helpers).toContain(
        "{{- if and .Values.app.storedObjects.localFilesystem.enabled (not .Values.app.dataplane.enabled) -}}",
      );
      expect(helpers).toContain(
        '{{- if and (eq (include "langwatch.storedObjects.localFilesystemIsActive" .) "true") .Values.workers.enabled .Values.app.storedObjects.localFilesystem.serializeUpgrades -}}',
      );
    });
  });

  describe("given the chart without workers", () => {
    /** @scenario "The chart refuses a release without workers, because the workers run the upgrade" */
    it("fails the render from the app Deployment, naming workers.enabled", () => {
      const helpers = readFromRoot("charts/langwatch/templates/_helpers.tpl");
      const guard = helpers.slice(
        helpers.indexOf('{{- define "langwatch.workersRequiredGuard" -}}'),
      );

      expect(guard).toMatch(
        /^\{\{- define "langwatch\.workersRequiredGuard" -\}\}\n\{\{- if not \.Values\.workers\.enabled \}\}\n\{\{- fail "workers\.enabled must be true: the workers run the upgrade/,
      );
      expect(readFromRoot("charts/langwatch/templates/app/deployment.yaml").split("\n")[1]).toBe(
        '{{- include "langwatch.workersRequiredGuard" . }}',
      );
    });
  });

  describe("given the self-hosted compose file", () => {
    /** @scenario "The compose stack has no migrate service; the app and workers wait only for their stores" */
    it("has no migrate service, and the app and the workers depend only on their stores", () => {
      const text = readFromRoot("infra/compose.yml");

      expect(text).not.toContain(PREPARE);
      expect(text).not.toMatch(/^ {2}migrate:$/m);
      for (const name of ["app", "workers"]) {
        const service = composeService({ text, name });
        const dependsOn = service.slice(service.indexOf("depends_on:"));
        const dependencies = [...dependsOn.matchAll(/^ {6}(\S+):$/gm)].map((match) => match[1]);
        expect(dependencies).toEqual(["postgres", "redis", "clickhouse"]);
        expect(service).not.toMatch(OLD_TASKS);
      }
    });
  });

  describe("given the npx server", () => {
    /** @scenario "The npx server starts its services with no migration phase" */
    it("starts the api and the worker with no migration phase, and lets the worker upgrade", () => {
      const runtime = uncommented(readFromRoot("apps/server/src/services/runtime.ts")).join("\n");
      const workers = uncommented(
        readFromRoot("apps/server/src/services/langwatch-workers.ts"),
      ).join("\n");

      expect(runtime).not.toMatch(/runMigrations|migrate\.ts|task upgrade/);
      expect(runtime).toMatch(/startLangwatch\(/);
      expect(runtime).toMatch(/startLangwatchWorkers\(/);
      expect(workers).not.toMatch(
        /SKIP_PRISMA_MIGRATE|SKIP_CLICKHOUSE_MIGRATE|SKIP_LWQL_PROVISION/,
      );
    });
  });

  describe("given the local launchers", () => {
    /** @scenario "The local launchers run the upgrade once before the lanes" */
    it("prepare once through the api's script, and the dev api service upgrades", () => {
      const launcher = uncommented(readFromRoot("dev/scripts/dev-stack.sh"));
      const devApi = composeService({ text: readFromRoot("dev/compose.dev.yml"), name: "api" });

      expect(launcher.filter((line) => line.includes(PREPARE))).toEqual([
        `pnpm --silent -C "$REPO_ROOT/apps/api" run ${PREPARE}`,
      ]);
      expect(devApi).toContain(`pnpm --silent run ${PREPARE} &&`);
      expect(devApi).not.toMatch(OLD_TASKS);
    });
  });
});
