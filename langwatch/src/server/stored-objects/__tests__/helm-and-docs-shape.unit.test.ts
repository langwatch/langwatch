/**
 * @vitest-environment node
 *
 * Source-of-truth shape checks for the deployment surface that stored-objects
 * relies on (helm chart, self-hosting docs, .env.example, route imports).
 *
 * These are file-content assertions, not behavior tests. They exist to bind
 * the feature scenarios that document deployment contracts so a future
 * accidental rename or removal trips CI instead of being caught at deploy
 * time. They read real files on disk; no mocks of the system under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Repo root containing both `langwatch/` and `charts/`. `process.cwd()`
// is the langwatch/ package dir when vitest runs (per package.json), so
// one level up lands on the repo root reliably across worktrees and CI.
const REPO_ROOT = path.resolve(process.cwd(), "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

describe("Helm chart deployment surface for stored-objects", () => {
  describe("when the env block emits dataplane storage variables", () => {
    /** @scenario "Helm chart emits S3_BUCKET_NAME (not legacy S3_BUCKET) so the app and stored-objects find the bucket" */
    it("emits S3_BUCKET_NAME and never emits a bare S3_BUCKET env line", () => {
      const helpers = readRepoFile("charts/langwatch/templates/_helpers.tpl");

      // The new name must appear in the rendered env list
      expect(helpers).toContain("- name: S3_BUCKET_NAME");

      // The legacy name must not appear as a rendered env entry.
      // (Matching the rendered form rules out comments that document the rename.)
      expect(helpers).not.toMatch(/^- name:\s+S3_BUCKET$/m);
    });
  });

  describe("when the chart describes the dataplane object-storage block", () => {
    /** @scenario "Helm chart exposes a single dataplane object-storage config block covering datasets and stored-objects together" */
    it("documents that the dataplane bucket is shared between datasets and stored-objects", () => {
      const helpers = readRepoFile("charts/langwatch/templates/_helpers.tpl");

      // The shared-dataplane explainer must live near the env emission so
      // future readers find it at the moment they're configuring the bucket.
      expect(helpers).toMatch(
        /shared between datasets and stored-objects|carries BOTH dataset uploads and\s+# externalized scenario media/,
      );

      // And the single condition (dataplane.enabled) governs both.
      expect(helpers).toContain(".Values.app.dataplane.enabled");
    });
  });

  describe("when localFilesystem.enabled is combined with multi-replica", () => {
    /** @scenario "Single-replica helm install can opt into a PVC-backed local-FS storage path" */
    it("renders a PVC bound to LANGWATCH_LOCAL_STORAGE_PATH and refuses multi-replica", () => {
      const pvc = readRepoFile("charts/langwatch/templates/app/stored-objects-pvc.yaml");
      const helpers = readRepoFile("charts/langwatch/templates/_helpers.tpl");

      // PVC template is gated on the "local-FS is the active backend" helper
      // (renders only when localFilesystem.enabled AND NOT dataplane.enabled).
      expect(pvc).toContain("langwatch.storedObjects.localFilesystemIsActive");
      expect(pvc).toContain("kind: PersistentVolumeClaim");

      // ReadWriteOnce forces single-pod consumption
      expect(pvc).toContain("ReadWriteOnce");

      // The helper itself is the single source of truth for the active-backend
      // condition: localFilesystem.enabled AND NOT dataplane.enabled.
      expect(helpers).toContain(".Values.app.storedObjects.localFilesystem.enabled");
      expect(helpers).toContain("not .Values.app.dataplane.enabled");

      // The validation block rejects localFilesystem + replicaCount > 1
      expect(helpers).toMatch(
        /localFilesystem\.enabled requires replicaCount=1|requires replicaCount=1/,
      );
    });
  });

  describe("when dataplane is enabled alongside localFilesystem default-on", () => {
    /** @scenario "Multi-replica install with dataplane on does NOT create the local-FS PVC, even when localFilesystem.enabled defaults to true" */
    it("PVC and volume mount only render when dataplane is OFF", () => {
      const pvc = readRepoFile("charts/langwatch/templates/app/stored-objects-pvc.yaml");
      const deployment = readRepoFile(
        "charts/langwatch/templates/app/deployment.yaml",
      );

      // Both the PVC and the volume mount must go through the
      // "localFilesystemIsActive" helper so multi-replica + dataplane.enabled
      // does NOT mount a single-attach RWO PVC into multiple pods.
      expect(pvc).toContain("langwatch.storedObjects.localFilesystemIsActive");
      expect(deployment).toContain("langwatch.storedObjects.localFilesystemIsActive");

      // Anti-regression: neither template gates only on the raw enabled toggle
      // (the bug Sergio caught — dataplane=true + localFS=true would still mount).
      const rawToggleRefsInPvc = (
        pvc.match(/\.Values\.app\.storedObjects\.localFilesystem\.enabled/g) || []
      ).length;
      expect(rawToggleRefsInPvc).toBe(0);
    });
  });

  describe("when neither dataplane S3 nor local-FS is configured", () => {
    /** @scenario "Vanilla helm install with no object storage configured surfaces the unconfigured-storage condition diagnostically and renders anyway" */
    it("the chart surfaces the unconfigured-storage condition diagnostically", () => {
      const helpers = readRepoFile("charts/langwatch/templates/_helpers.tpl");

      // Earlier in the PR this was a hard-fail; it was relaxed to a soft
      // condition so existing single-pod installs keep working on upgrade,
      // but the docstring must still call out the unconfigured-storage
      // scenario so operators reading the chart find the explanation.
      expect(helpers).toMatch(
        /Neither dataplane\.enabled nor localFilesystem\.enabled|ephemeral writable layer|writable container layer/,
      );
    });
  });
});

describe("Self-hosting docs cover the stored-objects deployment surface", () => {
  describe("when the environment-variables doc is loaded", () => {
    /** @scenario "Self-hosting docs describe stored-objects (scenario media, datasets, ...) externalization, the LANGWATCH_LOCAL_STORAGE_PATH env, and the shared dataplane bucket" */
    it("documents LANGWATCH_LOCAL_STORAGE_PATH and the shared dataplane bucket", () => {
      const doc = readRepoFile("docs/self-hosting/configuration/environment-variables.mdx");

      // The env var operators need to set for local-FS dev/single-pod use
      expect(doc).toContain("LANGWATCH_LOCAL_STORAGE_PATH");

      // The dataplane bucket is shared between datasets and stored-objects;
      // missing this explainer was a documented confusion point in review.
      expect(doc).toMatch(/dataplane.*shared|shared.*datasets.*stored-objects|stored-objects.*datasets/i);

      // Multi-pod operators MUST NOT rely on local-FS — call this out.
      expect(doc).toMatch(/multi.?pod|multiple pods/i);
    });
  });

  describe("when the architecture overview is loaded", () => {
    /** @scenario "Self-hosting docs describe stored-objects (scenario media, datasets, ...) externalization, the LANGWATCH_LOCAL_STORAGE_PATH env, and the shared dataplane bucket" */
    it("the architecture diagram shows an App -> S3 arrow for externalized byte content", () => {
      const overview = readRepoFile("docs/self-hosting/overview.mdx");

      // Diagram edge added in this PR — the existing CH->S3 cold-storage
      // arrow is not enough; the App pod itself writes externalized bytes
      // (scenario media, datasets, ...) into the shared dataplane bucket.
      // The label was reframed during PR #4058 review from "scenario media"
      // to "externalized byte content" so the docs accurately name S3 as
      // the general file-storage layer.
      expect(overview).toMatch(/App\s*-->\s*\|"externalized byte content[^"]*"\|\s*S3/);
    });
  });
});

describe(".env.example carries the local storage path config", () => {
  describe("when the example env file is loaded", () => {
    /** @scenario ".env.example carries LANGWATCH_LOCAL_STORAGE_PATH with a sensible local default" */
    it("contains LANGWATCH_LOCAL_STORAGE_PATH with the make-quickstart default and a multi-pod warning", () => {
      const example = readRepoFile("langwatch/.env.example");

      expect(example).toContain("LANGWATCH_LOCAL_STORAGE_PATH");
      // The default that maps to the LocalFilesystemDriver fallback in
      // stored-objects.service.ts — keeping these in sync matters because
      // a `make quickstart` user with no .env override gets the same path.
      expect(example).toMatch(/LANGWATCH_LOCAL_STORAGE_PATH=\/var\/lib\/langwatch\/objects/);
      // The multi-pod warning must be co-located with the var so a
      // production operator copying .env.example sees the caveat.
      expect(example).toMatch(/multi-pod|Multi-pod/);
    });
  });
});

describe("Route handlers delegate to the service and never touch the repository directly", () => {
  describe("when /api/scenario-events route imports are inspected", () => {
    /** @scenario "Route handlers delegate to the service and never touch the repository directly" */
    it("imports the service factory and does not import the repository", () => {
      const route = readRepoFile(
        "langwatch/src/app/api/scenario-events/[[...route]]/app.ts",
      );

      expect(route).toContain('from "~/server/stored-objects/stored-objects-factory"');
      // Direct repository import would be a layering violation
      expect(route).not.toContain('from "~/server/stored-objects/stored-objects.repository"');
    });
  });

  describe("when /api/files/:id route imports are inspected", () => {
    /** @scenario "Route handlers delegate to the service and never touch the repository directly" */
    it("imports the service factory and does not import the repository", () => {
      const route = readRepoFile("langwatch/src/app/api/files/[[...route]]/app.ts");

      expect(route).toContain('from "~/server/stored-objects/stored-objects-factory"');
      expect(route).not.toContain('from "~/server/stored-objects/stored-objects.repository"');
    });
  });
});

describe("storage_uri persisted on the stored_objects row is the authoritative bucket address", () => {
  describe("when the read path resolves a URI for an existing row", () => {
    /** @scenario "storage_uri persisted on the stored_objects row is the authoritative bucket address for reads" */
    it("the service reads back through the row's storage_uri (not env.S3_BUCKET_NAME)", () => {
      // This is the contract we promise BYOC tenants: writes that landed in
      // their private bucket must still come back from their private bucket
      // even after S3_BUCKET_NAME changes. The read path receives the row
      // and hands `row.storage_uri` to the registry — never the env.
      const service = readRepoFile(
        "langwatch/src/server/stored-objects/stored-objects.service.ts",
      );

      // The read code path must use row.storage_uri (the URI written at
      // ingest), not re-derive a URI from env. Grep for "registry.get(...row.storage_uri..."
      // proximity — both names appearing close together.
      const readPathMatch = service.match(
        /registry\.get[\s\S]{0,200}row\.storage_uri|row\.storage_uri[\s\S]{0,200}registry\.get/,
      );
      expect(readPathMatch).not.toBeNull();

      // And mintStorageUri is for writes only — there must not be a read
      // path that calls mintStorageUri to construct a fetch URI. Verify
      // that no usage of mintStorageUri appears inside the getById method
      // (the read path). We pick out the getById block by source-position
      // and check that mintStorageUri does not appear inside it.
      const getByIdStart = service.indexOf("async getById(");
      expect(getByIdStart).toBeGreaterThan(0);
      // The next `async ` after getByIdStart marks the end of getById's body.
      const nextMethodStart = service.indexOf("\n  async ", getByIdStart + 1);
      const getByIdBody = service.slice(
        getByIdStart,
        nextMethodStart > 0 ? nextMethodStart : undefined,
      );
      expect(getByIdBody).not.toContain("mintStorageUri");
    });
  });
});

describe("Stored objects migration is idempotent at the SQL level", () => {
  describe("when the migration file is inspected", () => {
    /** @scenario "Stored objects migration is idempotent" */
    it("uses CREATE TABLE IF NOT EXISTS so a second run is a no-op", () => {
      const migration = readRepoFile(
        "langwatch/src/server/clickhouse/migrations/00023_create_stored_objects.sql",
      );

      // The IF NOT EXISTS clause makes the migration safe to re-run.
      // Goose tracks applied migrations separately, but the underlying
      // SQL still has to tolerate a replay against an already-migrated DB
      // in case of bookkeeping drift.
      expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS\s+stored_objects/);

      // Schema name must NOT be hardcoded — Prisma reads schema from the
      // connection string, not the DDL. A qualified name would skew when
      // CLICKHOUSE_DATABASE is overridden in CI / multi-env deployments.
      expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+\$\{?CLICKHOUSE_DATABASE/);
    });
  });
});
