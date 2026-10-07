/**
 * Every entry point runs the one preparation script (`pnpm task upgrade`, then the
 * system-migrations pass) once before anything serves, read from the files that define them.
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
    /** @scenario "The one preparation script runs the upgrade, then the system-migrations pass" */
    it("runs upgrade, then the pass, each its own process and only on success", () => {
      expect(scripts[PREPARE]).toBe(
        "cd ../tasks && pnpm --silent task upgrade && pnpm --silent task system-migrations-pass",
      );
    });
  });

  describe("given the chart's pre-roll Job", () => {
    /** @scenario "The Helm pre-roll Job runs the upgrade on the new image" */
    it("runs the preparation script as a pre-upgrade hook only", () => {
      const job = readFromRoot("charts/langwatch/templates/app/migrate-pre-roll-job.yaml");
      const lines = uncommented(job.replace(/\{\{\/\*[\s\S]*?\*\/\}\}/g, ""));

      expect(lines).toContain("    helm.sh/hook: pre-upgrade");
      expect(lines).toContain(`          args: ["-s", "run", "${PREPARE}"]`);
      expect(lines).toContain("          workingDir: /app/apps/api");
      expect(lines.filter((line) => /pre-install|pre-rollback/.test(line))).toEqual([]);
    });
  });

  describe("given the self-hosted compose file", () => {
    /** @scenario "The compose stack runs a one-shot migrate service the app and workers wait for" */
    it("runs a migrate service the app and the workers wait on", () => {
      const text = readFromRoot("infra/compose.yml");
      const migrate = composeService({ text, name: "migrate" });

      expect(migrate).toContain(`command: ["pnpm", "--silent", "run", "${PREPARE}"]`);
      expect(migrate).toContain("working_dir: /app/apps/api");
      expect(migrate).toContain('restart: "no"');
      for (const name of ["app", "workers"]) {
        const service = composeService({ text, name });
        expect(service).toMatch(/migrate:\n\s+condition: service_completed_successfully/);
        expect(service).not.toMatch(OLD_TASKS);
      }
    });
  });

  describe("given the npx server", () => {
    /** @scenario "The npx server runs the upgrade once before its services" */
    it("runs upgrade, then the system-migrations pass, and no migration task of its own", () => {
      const code = uncommented(readFromRoot("apps/server/src/services/migrate.ts")).join("\n");

      expect(code).toMatch(
        /\["migrate:upgrade", "upgrade"\],\s+\["migrate:system-migrations", "system-migrations-pass"\]/,
      );
      expect(code).not.toMatch(OLD_TASKS);
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
