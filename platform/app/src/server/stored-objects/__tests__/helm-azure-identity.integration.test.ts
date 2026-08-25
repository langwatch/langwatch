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
 * with this error", or "the app and the workers name the SAME account" —
 * those are properties of the OUTPUT. The spec review called this out
 * explicitly.
 *
 * Skips when helm is unavailable so CI without the binary is unaffected.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CHART_DIR = path.resolve(__dirname, "../../../../../../charts/langwatch");
const BASE_VALUES = path.join(CHART_DIR, "tests", "values-e2e.yaml");

function hasHelm(): boolean {
  try {
    execFileSync("helm", ["version", "--short"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * `helm template` refuses to render until every dependency in Chart.yaml is
 * present under charts/. Three of ours are local file:// subcharts and one
 * (prometheus) is remote; the built .tgz files are gitignored, so a developer
 * checkout usually has them and a fresh CI runner does not — which made this
 * suite fail on "missing in charts/ directory" long before reaching any
 * assertion.
 *
 * Build them once if they're absent. If that can't be done (no network for the
 * remote chart), skip the suite rather than reporting a chart bug that isn't
 * one — the same honesty as the helm-not-installed guard above.
 */
function chartDepsReady(): boolean {
  // Every dependency in Chart.yaml must be present, not merely one archive:
  // a partial charts/ directory (a half-finished `helm dependency build`, or
  // a new dependency added since the last one) would otherwise look ready and
  // then fail the render on "missing in charts/ directory".
  const builtDir = path.join(CHART_DIR, "charts");
  const declared = (
    fs
      .readFileSync(path.join(CHART_DIR, "Chart.yaml"), "utf-8")
      .match(/^\s*-\s*name:\s*(\S+)/gm) ?? []
  ).map((line) => line.replace(/^\s*-\s*name:\s*/, "").trim());
  const built = fs.existsSync(builtDir) ? fs.readdirSync(builtDir) : [];
  const allPresent =
    declared.length > 0 &&
    declared.every((dep) =>
      built.some((f) => f.startsWith(`${dep}-`) && f.endsWith(".tgz")),
    );
  if (allPresent) return true;
  try {
    execFileSync("helm", ["dependency", "build", CHART_DIR], {
      stdio: "pipe",
      timeout: 180_000,
    });
    return true;
  } catch {
    // Only a genuinely unavailable dependency (no network, no repo definition)
    // may skip. Everything else — a stale Chart.lock, a mistyped dependency
    // repo — is a real chart bug, and swallowing it here would let the chart
    // switch off its own alarm.
    return false;
  }
}

const canRenderChart = hasHelm() && chartDepsReady();

/**
 * CI must never report these as skipped: the suite is the only enforcement of
 * the workload-identity label and ServiceAccount guards, so a silent skip
 * turns a green job into no coverage at all. Locally (no helm, no network) the
 * skip stays, which is what keeps it usable on a laptop.
 */
if (process.env.REQUIRE_HELM_TESTS === "1" && !canRenderChart) {
  throw new Error(
    "REQUIRE_HELM_TESTS=1 but the chart cannot be rendered here: helm is " +
      `${hasHelm() ? "present" : "MISSING"} and the chart dependencies are ` +
      "unavailable. Install helm and run `helm repo add` for the chart's " +
      "dependency repositories — do not let this suite skip in CI.",
  );
}

const describeHelm = canRenderChart ? describe : describe.skip;

/** Renders the chart, returning stdout. Throws on a failed render. */
function render(setArgs: string[]): string {
  return execFileSync(
    "helm",
    ["template", "t", CHART_DIR, "-f", BASE_VALUES, ...setArgs],
    {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    },
  );
}

/**
 * Renders expecting FAILURE, returning helm's own diagnostic text.
 *
 * Deliberately not asserting on the thrown Error's `message`: Node only folds
 * stderr into that message on some versions, so a test written against it
 * passes locally and fails in CI against the useless "Command failed: helm
 * template …". helm's actual complaint is always on stderr.
 */
function renderExpectingFailure(setArgs: string[]): string {
  try {
    render(setArgs);
  } catch (error: unknown) {
    const e = error as {
      stderr?: Buffer | string;
      stdout?: Buffer | string;
      message?: string;
    };
    return [e.stderr, e.stdout, e.message]
      .map((part) => (part == null ? "" : String(part)))
      .join("\n");
  }
  throw new Error("expected the chart render to fail, but it succeeded");
}

/** Every workload that touches object storage, so none is silently skipped. */
const ALL_WORKLOADS = [
  "--set",
  "workers.enabled=true",
  "--set",
  "cronjobs.enabled=true",
  "--set",
  "cronjobs.jobs.topicClustering.enabled=true",
];

/**
 * A ServiceAccount the chart creates AND annotates with the Entra client id.
 * The chart refuses workloadIdentity with `create=true` and no client-id: an
 * account the admission webhook cannot bind an identity to is the same runtime
 * failure as a pod with no label, one layer down. Token-mode tests therefore
 * supply both, exactly as a real install must.
 */
const IDENTITY_SERVICE_ACCOUNT = [
  "--set",
  "global.serviceAccount.create=true",
  "--set",
  String.raw`global.serviceAccount.annotations.azure\.workload\.identity/client-id=00000000-1111-2222-3333-444444444444`,
];

describeHelm("Helm object-storage provider selection", () => {
  /** @scenario "Helm selects S3 and Azure symmetrically without breaking legacy S3 configuration" */
  it("renders an explicit backend selector for both providers and keeps S3_BUCKET_NAME", () => {
    const s3 = render([
      "--set",
      "app.dataplane.enabled=true",
      "--set",
      "app.dataplane.provider=awsS3",
      "--set",
      "app.dataplane.bucket=existing-bucket",
      "--set",
      "app.storedObjects.localFilesystem.enabled=false",
    ]);
    const azure = render([
      "--set",
      "app.dataplane.enabled=true",
      "--set",
      "app.dataplane.provider=azureBlob",
      "--set",
      "app.dataplane.providers.azureBlob.accountName.value=acct",
      "--set",
      "app.dataplane.providers.azureBlob.accountKey.value=key",
      "--set",
      "app.dataplane.providers.azureBlob.container.value=container",
      "--set",
      "app.storedObjects.localFilesystem.enabled=false",
    ]);

    expect(s3).toContain("name: STORED_OBJECTS_BACKEND");
    expect(s3).toContain('value: "s3"');
    expect(s3).toContain("name: S3_BUCKET_NAME");
    expect(s3).toContain('value: "existing-bucket"');
    expect(azure).toContain("name: STORED_OBJECTS_BACKEND");
    expect(azure).toContain('value: "azure"');
  });
});

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
    it("names the same account on the app and the workers, and not on cron pods", () => {
      const out = render([...ALL_WORKLOADS, ...IDENTITY_SERVICE_ACCOUNT]);

      const named = out.match(/serviceAccountName: t$/gm) ?? [];
      // App and workers only. Cron pods curl the app over HTTP and never
      // touch storage, so binding the Blob identity to them would hand every
      // cron image access it has no use for.
      expect(named).toHaveLength(2);

      // And the webhook label on each of those same three pod templates:
      // a count short here means one workload silently never gets a token.
      const labelled = out.match(/^\s*azure\.workload\.identity\/use: "true"$/gm) ?? [];
      expect(labelled).toHaveLength(0);
    });

    /** @scenario "The chart binds every storage-touching workload to one federated service account" */
    it("carries the identity client-id annotation on the rendered account", () => {
      const out = render([...ALL_WORKLOADS, ...IDENTITY_SERVICE_ACCOUNT]);

      expect(out).toContain("kind: ServiceAccount");
      expect(out).toContain(
        "azure.workload.identity/client-id: 00000000-1111-2222-3333-444444444444",
      );
    });

    /**
     * A created ServiceAccount with no client-id annotation is the same class
     * of failure as a pod with no label: the chart renders, the pods come up
     * healthy, and the webhook has nothing to bind them to, so the first byte
     * fails blaming the operator's cluster. Only enforced when the chart
     * creates the account — a pre-existing account named by the operator lives
     * outside this chart and its annotations are not ours to inspect.
     */
    /** @scenario "The chart refuses a created service account with no identity annotation" */
    it("refuses to render workload identity with a created account carrying no client-id", () => {
      expect(
        renderExpectingFailure([
          ...ALL_WORKLOADS,
          "--set",
          "global.serviceAccount.create=true",
          "--set",
          "app.dataplane.enabled=true",
          "--set",
          "app.dataplane.provider=azureBlob",
          "--set",
          "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
          "--set",
          "app.dataplane.providers.azureBlob.accountName.value=acct",
          "--set",
          "app.dataplane.providers.azureBlob.container.value=cont",
          "--set",
          "app.storedObjects.localFilesystem.enabled=false",
        ]),
      ).toMatch(/azure\.workload\.identity\/client-id/);
    });

    /** @scenario "The chart refuses a created service account with no identity annotation" */
    it("still renders when the operator names a pre-existing account instead", () => {
      const out = render([
        ...ALL_WORKLOADS,
        "--set",
        "global.serviceAccount.name=external-identity",
        "--set",
        "app.dataplane.enabled=true",
        "--set",
        "app.dataplane.provider=azureBlob",
        "--set",
        "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
        "--set",
        "app.dataplane.providers.azureBlob.accountName.value=acct",
        "--set",
        "app.dataplane.providers.azureBlob.container.value=cont",
        "--set",
        "app.storedObjects.localFilesystem.enabled=false",
      ]);

      expect(out).toContain("serviceAccountName: external-identity");
    });

    /**
     * Least privilege (langwatch-agent review on PR #6181): cron pods only
     * curl the app over HTTP. Giving them the Blob-capable federated token
     * would mean a compromise of any cron image inherits Storage Blob Data
     * Contributor on the account for no functional gain.
     */
    it("never binds the storage identity to cron pods", () => {
      // workloadIdentity, not the sharedKey default: under sharedKey no label
      // is emitted anywhere, so asserting its absence on cron would prove
      // nothing at all.
      const out = render([
        "--set",
        "app.dataplane.enabled=true",
        "--set",
        "app.dataplane.provider=azureBlob",
        "--set",
        "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
        "--set",
        "app.dataplane.providers.azureBlob.accountName.value=acct",
        "--set",
        "app.dataplane.providers.azureBlob.container.value=cont",
        "--set",
        "app.storedObjects.localFilesystem.enabled=false",
        ...ALL_WORKLOADS,
        ...IDENTITY_SERVICE_ACCOUNT,
      ]);

      // The label must exist SOMEWHERE, or the negative assertions below are
      // vacuous — and it must be on exactly the two storage consumers.
      expect(
        out.match(/^\s*azure\.workload\.identity\/use: "true"$/gm) ?? [],
      ).toHaveLength(2);

      // Locate the CronJob document explicitly. `indexOf` returning -1 with a
      // bare slice would hand the assertions the final character of the
      // manifest, which trivially contains neither string.
      const cronIndex = out.indexOf("kind: CronJob");
      expect(cronIndex).toBeGreaterThan(-1);
      const cronSection = out.slice(cronIndex);

      expect(cronSection).not.toContain("serviceAccountName: t\n");
      expect(cronSection).not.toContain("azure.workload.identity/use");
    });

    /** @scenario "The chart leaves token projection to the platform webhook" */
    it("does not hand-mount a projected identity token volume", () => {
      const out = render([...ALL_WORKLOADS, ...IDENTITY_SERVICE_ACCOUNT]);

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
      "--set",
      "app.dataplane.enabled=true",
      "--set",
      "app.dataplane.provider=azureBlob",
      "--set",
      "app.dataplane.providers.azureBlob.accountName.value=acct",
      "--set",
      "app.dataplane.providers.azureBlob.container.value=cont",
      "--set",
      "app.storedObjects.localFilesystem.enabled=false",
    ];

    /** @scenario "The chart does not require an account key under a token-based mode" */
    it("renders with no account key and emits the auth mode instead", () => {
      const out = render([
        ...AZURE,
        "--set",
        "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
        ...IDENTITY_SERVICE_ACCOUNT,
      ]);

      expect(out).toContain("name: AZURE_BLOB_AUTH_MODE");
      expect(out).toContain('value: "workloadIdentity"');
      expect(out).not.toContain("AZURE_BLOB_ACCOUNT_KEY");
    });

    /** @scenario "The chart binds every storage-touching workload to one federated service account" */
    it("labels every storage-touching pod so the webhook mutates all of them", () => {
      const out = render([
        ...AZURE,
        ...ALL_WORKLOADS,
        "--set",
        "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
        ...IDENTITY_SERVICE_ACCOUNT,
      ]);

      // One per storage-touching pod template: app and workers. A count short
      // means a workload boots without a token and fails on its first storage
      // call, which is exactly the shape of the bug this label exists to
      // prevent. The cron pods are deliberately not among them — they only
      // call the app over HTTP and never reach storage themselves, and the
      // sibling "never binds the storage identity to cron pods" pins that
      // exclusion rather than leaving it to this count.
      const labelled = out.match(/^\s*azure\.workload\.identity\/use: "true"$/gm) ?? [];
      expect(labelled).toHaveLength(2);
    });

    /** @scenario "The chart does not require an account key under a token-based mode" */
    it("refuses a stray account key that would be silently ignored", () => {
      expect(
        renderExpectingFailure([
          ...AZURE,
          "--set",
          "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
          ...IDENTITY_SERVICE_ACCOUNT,
          "--set",
          "app.dataplane.providers.azureBlob.accountKey.value=leftover",
        ]),
      ).toMatch(/accountKey is also configured/);
    });

    /** @scenario "The chart does not require an account key under a token-based mode" */
    it("refuses workload identity with no service account to bind the identity to", () => {
      expect(
        renderExpectingFailure([
          ...AZURE,
          "--set",
          "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
        ]),
      ).toMatch(/requires global\.serviceAccount/);
    });

    /** @scenario "An unrecognized AZURE_BLOB_AUTH_MODE value is rejected, not ignored" */
    it("refuses an auth mode outside the supported set", () => {
      expect(
        renderExpectingFailure([
          ...AZURE,
          "--set",
          "app.dataplane.providers.azureBlob.authMode=nonsense",
        ]),
      ).toMatch(/must be one of sharedKey, workloadIdentity, managedIdentity, azureCli/);
    });
  });

  describe("given a sovereign-cloud endpoint under a token-based mode", () => {
    const SOVEREIGN = [
      "--set",
      "app.dataplane.enabled=true",
      "--set",
      "app.dataplane.provider=azureBlob",
      "--set",
      "app.dataplane.providers.azureBlob.authMode=managedIdentity",
      "--set",
      "app.dataplane.providers.azureBlob.accountName.value=acct",
      "--set",
      "app.dataplane.providers.azureBlob.container.value=cont",
      "--set",
      "app.dataplane.providers.azureBlob.endpoint.value=https://acct.blob.core.usgovcloudapi.net",
      "--set",
      "app.storedObjects.localFilesystem.enabled=false",
    ];

    /**
     * Regression (langwatch-agent review on PR #6181): the chart emitted the
     * sovereign endpoint but had no value for the identity authority, so it
     * rendered green and the app then refused the combination at the first
     * storage call. Failing at render moves that to deploy time.
     */
    it("refuses to render without a matching identity authority", () => {
      expect(renderExpectingFailure(SOVEREIGN)).toMatch(/not the Azure public cloud/);
    });

    it("emits the authority and audience when they are configured", () => {
      const out = render([
        ...SOVEREIGN,
        "--set",
        "app.dataplane.providers.azureBlob.authorityHost.value=https://login.microsoftonline.us",
        "--set",
        "app.dataplane.providers.azureBlob.tokenAudience.value=https://storage.azure.us",
      ]);

      expect(out).toContain("name: AZURE_BLOB_AUTHORITY_HOST");
      expect(out).toContain('value: "https://login.microsoftonline.us"');
      expect(out).toContain("name: AZURE_BLOB_TOKEN_AUDIENCE");
      expect(out).toContain('value: "https://storage.azure.us"');
    });

    /**
     * Hostnames are case-insensitive and the app's runtime check lowercases
     * before classifying — an uppercase public-cloud endpoint must not be
     * mistaken for sovereign and rejected for a missing authority.
     */
    it("classifies an uppercase public-cloud endpoint as public, not sovereign", () => {
      const out = render(
        SOVEREIGN.map((arg) =>
          arg.includes("endpoint.value=")
            ? "app.dataplane.providers.azureBlob.endpoint.value=https://ACCT.BLOB.CORE.WINDOWS.NET"
            : arg,
        ),
      );

      expect(out).toContain("name: AZURE_BLOB_ENDPOINT");
    });
  });

  describe("given workloadIdentity with a service account the chart creates", () => {
    const WORKLOAD_IDENTITY = [
      ...ALL_WORKLOADS,
      "--set",
      "app.dataplane.enabled=true",
      "--set",
      "app.dataplane.provider=azureBlob",
      "--set",
      "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
      "--set",
      "app.dataplane.providers.azureBlob.accountName.value=acct",
      "--set",
      "app.dataplane.providers.azureBlob.container.value=cont",
      "--set",
      "app.storedObjects.localFilesystem.enabled=false",
    ];

    /** @scenario "The chart refuses a created service account with no identity annotation" */
    it("refuses to render when the account carries no client-id annotation", () => {
      expect(
        renderExpectingFailure([
          ...WORKLOAD_IDENTITY,
          "--set",
          "global.serviceAccount.create=true",
        ]),
      ).toMatch(/azure\.workload\.identity\/client-id/);
    });

    /** @scenario "The chart refuses a created service account with no identity annotation" */
    it("renders once the client-id annotation is supplied", () => {
      const out = render([...WORKLOAD_IDENTITY, ...IDENTITY_SERVICE_ACCOUNT]);

      expect(out).toContain('azure.workload.identity/use: "true"');
    });

    /**
     * A pre-existing account lives outside the chart, so its annotations
     * cannot be inspected — that prerequisite is documented rather than
     * enforced, and rendering must not be blocked on it.
     */
    /** @scenario "The chart refuses a created service account with no identity annotation" */
    it("still renders when the operator names a pre-existing account instead", () => {
      const out = render([
        ...WORKLOAD_IDENTITY,
        "--set",
        "global.serviceAccount.name=external-identity",
      ]);

      expect(out).toContain("serviceAccountName: external-identity");
    });
  });

  describe("given a token mode whose blob endpoint comes from a Secret", () => {
    const SECRET_ENDPOINT = [
      ...ALL_WORKLOADS,
      ...IDENTITY_SERVICE_ACCOUNT,
      "--set",
      "app.dataplane.enabled=true",
      "--set",
      "app.dataplane.provider=azureBlob",
      "--set",
      "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
      "--set",
      "app.dataplane.providers.azureBlob.accountName.value=acct",
      "--set",
      "app.dataplane.providers.azureBlob.container.value=cont",
      "--set",
      "app.dataplane.providers.azureBlob.endpoint.secretKeyRef.name=azure-endpoint",
      "--set",
      "app.dataplane.providers.azureBlob.endpoint.secretKeyRef.key=url",
      "--set",
      "app.storedObjects.localFilesystem.enabled=false",
    ];

    /**
     * Helm cannot read the Secret, so the hostname is unknowable at render
     * time. Assuming "public cloud" is the one guess that fails silently: the
     * deploy succeeds and the first storage call is refused for asking the
     * wrong issuer for a token.
     */
    /** @scenario "The chart refuses a secret-supplied endpoint with no identity authority" */
    it("refuses to render without an identity authority", () => {
      expect(renderExpectingFailure(SECRET_ENDPOINT)).toMatch(
        /supplied through a Secret/,
      );
    });

    /** @scenario "The chart refuses a secret-supplied endpoint with no identity authority" */
    it("renders once an authority host is configured alongside it", () => {
      const out = render([
        ...SECRET_ENDPOINT,
        "--set",
        "app.dataplane.providers.azureBlob.authorityHost.value=https://login.microsoftonline.us",
      ]);

      expect(out).toContain("name: AZURE_BLOB_AUTHORITY_HOST");
    });

    /** @scenario "A sovereign-cloud endpoint without a matching authority is refused" */
    it("leaves a public-cloud install alone, which sets no endpoint at all", () => {
      const out = render([
        ...ALL_WORKLOADS,
        ...IDENTITY_SERVICE_ACCOUNT,
        "--set",
        "app.dataplane.enabled=true",
        "--set",
        "app.dataplane.provider=azureBlob",
        "--set",
        "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
        "--set",
        "app.dataplane.providers.azureBlob.accountName.value=acct",
        "--set",
        "app.dataplane.providers.azureBlob.container.value=cont",
        "--set",
        "app.storedObjects.localFilesystem.enabled=false",
      ]);

      expect(out).toContain('azure.workload.identity/use: "true"');
    });
  });

  describe("given the azureBlob provider under shared-key auth", () => {
    /** @scenario "The chart still demands an account key under shared-key auth" */
    it("fails with an error naming the missing accountKey", () => {
      expect(
        renderExpectingFailure([
          "--set",
          "app.dataplane.enabled=true",
          "--set",
          "app.dataplane.provider=azureBlob",
          "--set",
          "app.dataplane.providers.azureBlob.accountName.value=acct",
          "--set",
          "app.dataplane.providers.azureBlob.container.value=cont",
          "--set",
          "app.storedObjects.localFilesystem.enabled=false",
        ]),
      ).toMatch(/accountKey is not configured/);
    });
  });

  /**
   * Regression: an Azure->S3 migration keeps Azure settings alive for READS
   * (legacyAzureRead) while writes move to S3. Both the identity label and the
   * chart's validation used to be gated on `provider == "azureBlob"`, which is
   * false here — so the pod got the Azure connection settings but no injected
   * token, `maybeAzureDriver()` returned undefined, and every historical
   * azure-blob:// object became unreadable with the chart still rendering green.
   */
  describe("given an Azure->S3 migration under workload identity", () => {
    /** The migration itself, with no identity backing it. */
    const MIGRATION_WITHOUT_SERVICE_ACCOUNT = [
      ...ALL_WORKLOADS,
      "--set",
      "app.dataplane.enabled=true",
      "--set",
      "app.dataplane.provider=awsS3",
      "--set",
      "app.dataplane.bucket=bucket",
      "--set",
      "app.dataplane.legacyAzureRead=true",
      "--set",
      "app.dataplane.providers.azureBlob.authMode=workloadIdentity",
      "--set",
      "app.dataplane.providers.azureBlob.accountName.value=acct",
      "--set",
      "app.dataplane.providers.azureBlob.container.value=cont",
      "--set",
      "app.storedObjects.localFilesystem.enabled=false",
    ];

    const MIGRATION = [...MIGRATION_WITHOUT_SERVICE_ACCOUNT, ...IDENTITY_SERVICE_ACCOUNT];

    /** @scenario "Historical Azure objects stay readable after moving writes to S3" */
    it("writes to S3 while keeping the Azure read settings", () => {
      const out = render(MIGRATION);

      // The S3 WRITE configuration must render exactly as on a plain S3
      // install — an earlier version of the chart dropped it whenever
      // legacyAzureRead was set, so new writes silently fell back to local
      // storage while the operator believed S3 was live.
      expect(out).toContain("name: STORED_OBJECTS_BACKEND");
      expect(out).toContain('value: "s3"');
      expect(out).toContain("name: USE_S3_STORAGE");
      expect(out).toContain("name: S3_BUCKET_NAME");
      expect(out).toContain('value: "bucket"');
      // ...and the connection settings the read path resolves must remain.
      expect(out).toContain("name: AZURE_BLOB_ACCOUNT_NAME");
      expect(out).toContain("name: AZURE_BLOB_CONTAINER");
      expect(out).toContain('value: "workloadIdentity"');
      // The write toggle must never say azure here.
      expect(out).not.toContain('value: "azure"');
    });

    /** @scenario "Historical Azure objects stay readable after moving writes to S3" */
    it("still labels app and workers so the webhook injects a token", () => {
      const out = render(MIGRATION);

      // Without this the webhook never fires and the reads fail at runtime.
      expect(out.match(/azure\.workload\.identity\/use: "true"/g) ?? []).toHaveLength(2);
    });

    /** @scenario "Cron pods never receive the storage identity" */
    it("still withholds the identity from cron pods", () => {
      const out = render(MIGRATION);

      const cronIndex = out.indexOf("kind: CronJob");
      expect(cronIndex).toBeGreaterThan(-1);
      expect(out.slice(cronIndex)).not.toContain("azure.workload.identity/use");
    });

    /** @scenario "The chart refuses a workload-identity install with no service account" */
    it("refuses to render when no service account backs the identity", () => {
      expect(renderExpectingFailure(MIGRATION_WITHOUT_SERVICE_ACCOUNT)).toMatch(
        /ServiceAccount to bind to/,
      );
    });
  });

  describe("given a legacy read flag contradicting the active provider", () => {
    /** @scenario "The chart rejects a legacy read flag aimed at the active provider" */
    it("rejects legacyAzureRead while azureBlob is already active", () => {
      expect(
        renderExpectingFailure([
          "--set",
          "app.dataplane.enabled=true",
          "--set",
          "app.dataplane.provider=azureBlob",
          "--set",
          "app.dataplane.providers.azureBlob.accountName.value=acct",
          "--set",
          "app.dataplane.providers.azureBlob.accountKey.value=key",
          "--set",
          "app.dataplane.providers.azureBlob.container.value=cont",
          "--set",
          "app.dataplane.legacyAzureRead=true",
        ]),
      ).toMatch(/legacyAzureRead is set but azureBlob is already the active provider/);
    });

    /** @scenario "The chart rejects a legacy read flag aimed at the active provider" */
    it("rejects legacyS3ReadBucket while awsS3 is already active", () => {
      expect(
        renderExpectingFailure([
          "--set",
          "app.dataplane.enabled=true",
          "--set",
          "app.dataplane.provider=awsS3",
          "--set",
          "app.dataplane.legacyS3ReadBucket=old-bucket",
        ]),
      ).toMatch(/legacyS3ReadBucket is set but awsS3 is already the active provider/);
    });

    /** @scenario "The chart rejects a legacy read flag aimed at the active provider" */
    it("rejects an awsS3 install whose bucket is empty", () => {
      expect(
        renderExpectingFailure([
          "--set",
          "app.dataplane.enabled=true",
          "--set",
          "app.dataplane.provider=awsS3",
          "--set",
          "app.dataplane.bucket=",
        ]),
      ).toMatch(/app\.dataplane\.bucket is empty/);
    });
  });

  describe("given an existing account name is supplied instead", () => {
    /** @scenario "The chart binds every storage-touching workload to one federated service account" */
    it("uses that name without rendering an account of its own", () => {
      const out = render([
        ...ALL_WORKLOADS,
        "--set",
        "global.serviceAccount.name=preexisting-identity",
      ]);

      expect(out.match(/serviceAccountName: preexisting-identity$/gm) ?? []).toHaveLength(
        2,
      );
      // create=false, so we must not manufacture the account.
      expect(out).not.toMatch(
        /kind: ServiceAccount\n[\s\S]{0,200}?name: preexisting-identity\n/,
      );
    });
  });
});
