/**
 * @vitest-environment node
 * @integration
 *
 * Issue #6087 / #6182 — the chart's ServiceAccount surface, verified by
 * running `helm template` for real and reading the rendered YAML.
 *
 * Deliberately NOT a unit test asserting on template source text. The
 * sibling `helm-and-docs-shape.unit.test.ts` greps `_helpers.tpl`, which can
 * show a string exists but can never prove "renders successfully", "fails
 * with this error", or "all three workloads name the SAME account" — those
 * are properties of the OUTPUT. The spec review called this out explicitly.
 *
 * Skips when helm is unavailable so CI without the binary is unaffected.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CHART_DIR = path.resolve(__dirname, "../../../../../charts/langwatch");
const BASE_VALUES = path.join(CHART_DIR, "tests", "values-e2e.yaml");

function hasHelm(): boolean {
  try {
    execFileSync("helm", ["version", "--short"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const describeHelm = hasHelm() ? describe : describe.skip;

/** Renders the chart, returning stdout. Throws with stderr on failure. */
function render(setArgs: string[]): string {
  return execFileSync(
    "helm",
    ["template", "t", CHART_DIR, "-f", BASE_VALUES, ...setArgs],
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 },
  );
}

/** Every workload that touches object storage, so none is silently skipped. */
const ALL_WORKLOADS = [
  "--set", "workers.enabled=true",
  "--set", "cronjobs.enabled=true",
  "--set", "cronjobs.jobs.topicClustering.enabled=true",
];

describeHelm("Helm ServiceAccount surface for cloud identity", () => {
  describe("given an install that does not opt in", () => {
    /** @scenario "Installs that do not use Azure render exactly as they did before" */
    it("introduces no service account and names none on our workloads", () => {
      const out = render([...ALL_WORKLOADS]);

      // The clickhouse subchart brings its own account; ours must add nothing.
      // Matching on the release-name value keeps that distinction exact.
      expect(out).not.toContain("serviceAccountName: t\n");
      expect(out).not.toMatch(/kind: ServiceAccount\n[\s\S]{0,200}?name: t\n/);
    });
  });

  describe("given the service account is enabled with an identity annotation", () => {
    /** @scenario "The chart binds every storage-touching workload to one federated service account" */
    it("names the same account on the app, the workers, and the cronjobs", () => {
      const out = render([
        ...ALL_WORKLOADS,
        "--set", "global.serviceAccount.create=true",
      ]);

      const named = out.match(/serviceAccountName: t$/gm) ?? [];
      // App + workers + cronjob — one each, all resolving to the same name.
      expect(named).toHaveLength(3);
    });

    /** @scenario "The chart binds every storage-touching workload to one federated service account" */
    it("carries the identity client-id annotation on the rendered account", () => {
      const out = render([
        ...ALL_WORKLOADS,
        "--set", "global.serviceAccount.create=true",
        "--set", String.raw`global.serviceAccount.annotations.azure\.workload\.identity/client-id=00000000-1111-2222-3333-444444444444`,
      ]);

      expect(out).toContain("kind: ServiceAccount");
      expect(out).toContain(
        "azure.workload.identity/client-id: 00000000-1111-2222-3333-444444444444",
      );
    });

    /** @scenario "The chart leaves token projection to the platform webhook" */
    it("does not hand-mount a projected identity token volume", () => {
      const out = render([
        ...ALL_WORKLOADS,
        "--set", "global.serviceAccount.create=true",
      ]);

      // The platform webhook injects its own projected volume; a second one
      // from the chart would collide with it. Asserted against the rendered
      // volume structure rather than the audience string, because a template
      // COMMENT mentioning the audience would satisfy a string check while
      // the chart still hand-rolled the volume.
      const withoutComments = out
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");

      expect(withoutComments).not.toContain("serviceAccountToken:");
      expect(withoutComments).not.toContain("api://AzureADTokenExchange");
    });
  });

  describe("given the azureBlob provider under a token-based auth mode", () => {
    const AZURE = [
      "--set", "app.dataplane.enabled=true",
      "--set", "app.dataplane.provider=azureBlob",
      "--set", "app.dataplane.providers.azureBlob.accountName.value=acct",
      "--set", "app.dataplane.providers.azureBlob.container.value=cont",
      "--set", "app.storedObjects.localFilesystem.enabled=false",
    ];

    /** @scenario "The chart does not require an account key under a token-based mode" */
    it("renders with no account key and emits the auth mode instead", () => {
      const out = render([
        ...AZURE,
        "--set", "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
        "--set", "global.serviceAccount.create=true",
      ]);

      expect(out).toContain("name: AZURE_BLOB_AUTH_MODE");
      expect(out).toContain('value: "workloadIdentity"');
      expect(out).not.toContain("AZURE_BLOB_ACCOUNT_KEY");
    });

    /** @scenario "The chart does not require an account key under a token-based mode" */
    it("refuses a stray account key that would be silently ignored", () => {
      expect(() =>
        render([
          ...AZURE,
          "--set", "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
          "--set", "global.serviceAccount.create=true",
          "--set", "app.dataplane.providers.azureBlob.accountKey.value=leftover",
        ]),
      ).toThrow(/accountKey is also configured/);
    });

    /** @scenario "The chart does not require an account key under a token-based mode" */
    it("refuses workload identity with no service account to bind the identity to", () => {
      expect(() =>
        render([
          ...AZURE,
          "--set", "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
        ]),
      ).toThrow(/requires global\.serviceAccount/);
    });

    /** @scenario "An unrecognized AZURE_BLOB_AUTH_MODE value is rejected, not ignored" */
    it("refuses an auth mode outside the supported set", () => {
      expect(() =>
        render([
          ...AZURE,
          "--set", "app.dataplane.providers.azureBlob.authMode=nonsense",
        ]),
      ).toThrow(/must be one of sharedKey, workloadIdentity, managedIdentity, azureCli/);
    });
  });

  describe("given the azureBlob provider under shared-key auth", () => {
    /** @scenario "The chart still demands an account key under shared-key auth" */
    it("fails with an error naming the missing accountKey", () => {
      expect(() =>
        render([
          "--set", "app.dataplane.enabled=true",
          "--set", "app.dataplane.provider=azureBlob",
          "--set", "app.dataplane.providers.azureBlob.accountName.value=acct",
          "--set", "app.dataplane.providers.azureBlob.container.value=cont",
          "--set", "app.storedObjects.localFilesystem.enabled=false",
        ]),
      ).toThrow(/accountKey is not configured/);
    });
  });

  describe("given an existing account name is supplied instead", () => {
    /** @scenario "The chart binds every storage-touching workload to one federated service account" */
    it("uses that name without rendering an account of its own", () => {
      const out = render([
        ...ALL_WORKLOADS,
        "--set", "global.serviceAccount.name=preexisting-identity",
      ]);

      expect(out.match(/serviceAccountName: preexisting-identity$/gm) ?? []).toHaveLength(3);
      // create=false, so we must not manufacture the account.
      expect(out).not.toMatch(/kind: ServiceAccount\n[\s\S]{0,200}?name: preexisting-identity\n/);
    });
  });
});
