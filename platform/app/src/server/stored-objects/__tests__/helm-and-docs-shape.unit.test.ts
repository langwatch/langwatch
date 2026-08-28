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

// Repo root containing both `platform/app/` and `charts/`. `process.cwd()`
// is the platform/app/ package dir when vitest runs (per package.json), so
// two levels up lands on the repo root reliably across worktrees and CI.
const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

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
      const deployment = readRepoFile("charts/langwatch/templates/app/deployment.yaml");

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

describe("Helm chart exposes an Azure Blob dataplane provider (AC37, issue #4133)", () => {
  describe("when the app.dataplane.providers block is inspected", () => {
    /** @scenario "Helm chart exposes an azureBlob dataplane provider mirroring awsS3" */
    it("offers azureBlob with accountName, accountKey, and container, each accepting a value or secretKeyRef", () => {
      const values = readRepoFile("charts/langwatch/values.yaml");

      expect(values).toMatch(/azureBlob:/);
      // Each secret-bearing field appears with BOTH a `value:` and a
      // `secretKeyRef:` sibling, mirroring the awsS3 provider's shape.
      for (const field of ["accountName", "accountKey", "container"]) {
        const fieldBlock = values.match(
          new RegExp(`${field}:\\s*\\n\\s*value:[^\\n]*\\n(?:[^\\n]*\\n)?\\s*secretKeyRef:`),
        );
        expect(fieldBlock, `expected ${field} to declare value + secretKeyRef`).not.toBeNull();
      }
    });
  });

  describe("when the azureBlob provider is selected", () => {
    /** @scenario "Helm chart exposes an azureBlob dataplane provider mirroring awsS3" */
    it("emits STORED_OBJECTS_BACKEND=azure and the AZURE_BLOB_* env vars on the deployment", () => {
      const helpers = readRepoFile("charts/langwatch/templates/_helpers.tpl");

      expect(helpers).toMatch(/eq \.Values\.app\.dataplane\.provider "azureBlob"/);
      expect(helpers).toContain("STORED_OBJECTS_BACKEND");
      expect(helpers).toMatch(/value:\s*"azure"/);
      expect(helpers).toContain("AZURE_BLOB_ACCOUNT_NAME");
      expect(helpers).toContain("AZURE_BLOB_ACCOUNT_KEY");
      expect(helpers).toContain("AZURE_BLOB_CONTAINER");
    });

    /** @scenario "Helm chart exposes an azureBlob dataplane provider mirroring awsS3" */
    it("offers an optional endpoint override for sovereign clouds and private endpoints", () => {
      const values = readRepoFile("charts/langwatch/values.yaml");
      const helpers = readRepoFile("charts/langwatch/templates/_helpers.tpl");

      expect(values).toMatch(
        /azureBlob:[\s\S]*?endpoint:\s*\n\s*value: ""\s*\n[\s\S]*?secretKeyRef/,
      );
      expect(helpers).toContain("AZURE_BLOB_ENDPOINT");
    });

    /**
     * Ruthless-review P2 on PR #6092: flipping the provider to azureBlob used
     * to drop S3_BUCKET_NAME from the deployment in the same act, so the
     * migration semantics createS3Client implements (legacy s3:// reads
     * survive while a bucket is configured) were unreachable from the chart.
     */
    it("can still emit the legacy S3 read config while azure is the write backend", () => {
      const values = readRepoFile("charts/langwatch/values.yaml");
      const helpers = readRepoFile("charts/langwatch/templates/_helpers.tpl");

      expect(values).toContain("legacyS3ReadBucket");
      // Emitted when azureBlob is the ACTIVE provider AND the opt-in value is
      // set — the double gate is what prevents a duplicate S3_BUCKET_NAME
      // when S3 is active (its own write block already emits one).
      expect(helpers).toMatch(
        /if and \(eq \.Values\.app\.dataplane\.provider "azureBlob"\) \.Values\.app\.dataplane\.legacyS3ReadBucket[\s\S]*?S3_BUCKET_NAME/,
      );
    });
  });

  describe("when azureBlob is selected alongside a multi-replica install", () => {
    /** @scenario "Selecting the azureBlob provider satisfies the multi-replica shared-storage guard" */
    it("the local-FS multi-replica hard-fail is gated on dataplane.enabled generically, not the awsS3 provider specifically", () => {
      const helpers = readRepoFile("charts/langwatch/templates/_helpers.tpl");

      // The hard-fail guard trips only when local-FS is the ACTIVE backend
      // (dataplane.enabled is false). It does not special-case the provider
      // name, so dataplane.enabled=true with provider=azureBlob already
      // disables local-FS as the active backend — same as provider=awsS3 —
      // and the render succeeds at replicaCount > 1.
      const guardMatch = helpers.match(
        /\{\{-\s*if and \.Values\.app\.storedObjects\.localFilesystem\.enabled \(not \.Values\.app\.dataplane\.enabled\) \}\}[\s\S]{0,400}requires replicaCount=1/,
      );
      expect(guardMatch).not.toBeNull();

      // localFilesystemIsActive — the single source of truth both the PVC and
      // the deployment volume mount gate on — is provider-agnostic too.
      expect(helpers).toContain(
        "if and .Values.app.storedObjects.localFilesystem.enabled (not .Values.app.dataplane.enabled)",
      );
      expect(helpers).toMatch(/S3\/Azure is the\s*\n?\s*active backend/);
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
      expect(doc).toMatch(
        /dataplane.*shared|shared.*datasets.*stored-objects|stored-objects.*datasets/i,
      );

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
      const example = readRepoFile(".env.example");

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

describe(".env.example and self-hosting docs describe the Azure stored-objects backend (AC37, issue #4133)", () => {
  describe("when the example env file is loaded", () => {
    /** @scenario ".env.example and self-hosting docs describe the Azure stored-objects backend" */
    it("documents AZURE_BLOB_* as live config, no longer deferred, alongside STORED_OBJECTS_BACKEND and AZURE_BLOB_CONTAINER", () => {
      const example = readRepoFile(".env.example");

      expect(example).not.toMatch(/Azure Blob Storage.*DEFERRED/i);
      expect(example).toContain("STORED_OBJECTS_BACKEND");
      expect(example).toContain("AZURE_BLOB_ACCOUNT_NAME");
      expect(example).toContain("AZURE_BLOB_ACCOUNT_KEY");
      expect(example).toContain("AZURE_BLOB_CONTAINER");
      // The explicit-toggle rationale must be documented, not just the vars.
      expect(example).toMatch(/EXPLICIT toggle|explicit toggle/);
    });

    /** @scenario "Self-hosting docs describe the enterprise authentication path" */
    it("documents every auth mode, the required role assignment, and the AKS-only limit", () => {
      const doc = readRepoFile("docs/self-hosting/configuration/environment-variables.mdx");

      expect(doc).toContain("AZURE_BLOB_AUTH_MODE");
      for (const mode of ["sharedKey", "workloadIdentity", "managedIdentity", "azureCli"]) {
        expect(doc).toContain(mode);
      }

      // The role that actually grants data access, and the trap of granting
      // the control-plane role instead.
      expect(doc).toContain("Storage Blob Data Contributor");
      expect(doc).toMatch(/Contributor.*does \*not\* grant data access/);

      // Shared-key config is unnecessary in token modes, and federated
      // Kubernetes identity is AKS-only.
      expect(doc).toMatch(/no fallback|There is no fallback/i);
      expect(doc).toMatch(/AKS only|AKS\*\* only/i);
    });
  });

  describe("when the self-hosting environment-variables doc is loaded", () => {
    /** @scenario ".env.example and self-hosting docs describe the Azure stored-objects backend" */
    it("documents the Azure stored-objects block with the explicit-toggle rationale", () => {
      const doc = readRepoFile("docs/self-hosting/configuration/environment-variables.mdx");

      expect(doc).toContain("STORED_OBJECTS_BACKEND");
      expect(doc).toContain("AZURE_BLOB_ACCOUNT_NAME");
      expect(doc).toContain("AZURE_BLOB_ACCOUNT_KEY");
      expect(doc).toContain("AZURE_BLOB_CONTAINER");
      expect(doc).toMatch(/explicit/i);
      expect(doc).toMatch(/#4133/);
    });
  });
});

describe("Route handlers delegate to the service and never touch the repository directly", () => {
  describe("when /api/scenario-events route imports are inspected", () => {
    /** @scenario "Route handlers delegate to the service and never touch the repository directly" */
    it("takes media extraction as an injected port and does not import the repository", () => {
      // The family moved to `@langwatch/platform-api`, which has no stored
      // objects of its own: the walk arrives as a port the process binds to
      // its own service, so the transport cannot reach past it.
      const route = readRepoFile("apps/api/src/features/scenario/scenario-event-rest.ts");

      expect(route).toContain("extractInlineMedia");
      // Direct repository import would be a layering violation
      expect(route).not.toContain("stored-objects.repository");
    });
  });

  describe("when /api/files/:id route imports are inspected", () => {
    /** @scenario "Route handlers delegate to the service and never touch the repository directly" */
    it("imports the service factory and does not import the repository", () => {
      const route = readRepoFile("apps/api/src/features/stored-object/files-rest.ts");

      // The family takes the stored-object services as arguments now, so the
      // assertion is that it dispatches through a service at all and still
      // never names a repository.
      expect(route).toContain("storedObjects()");
      expect(route).not.toContain("stored-objects.repository");
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
        "platform/app/src/server/stored-objects/stored-objects.service.ts",
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
        "platform/app/src/server/clickhouse/migrations/00023_create_stored_objects.sql",
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
