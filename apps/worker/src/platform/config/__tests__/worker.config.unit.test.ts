import { InvalidRuntimeConfigError } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { resolveWorkerConfig, resolveWorkerTracePrivacyConfig } from "../worker.config";

describe("resolveWorkerConfig", () => {
  it("uses the worker-local environment default", () => {
    const config = resolveWorkerConfig({});

    expect(config).toEqual({
      processRole: "worker",
      environment: "local",
      nodeEnvironment: "development",
      serviceName: "langwatch:worker",
      serviceVersion: undefined,
      logger: {
        format: undefined,
        level: undefined,
        consoleLevel: undefined,
        otelExportEnabled: undefined,
      },
      observability: {
        apiKey: undefined,
        endpoint: undefined,
        processorType: "batch",
      },
      shutdown: { processDeadlineMs: 25_000 },
      deployment: { saas: false },
      // No `credentialsEncryptionKey`: an install that stored no encrypted
      // automation credential has none to read, and the key is omitted rather
      // than carried as an empty string that would look configured.
      automation: { emailHourlyCap: 100, tenantDailyCap: 10_000 },
      // Redaction is DEFAULT-ON without any of the four variables: the native
      // floor enforces, and the analysis service is simply absent. The one
      // knob that turns the floor off has to be spelled `off` to do it.
      tracePrivacy: {
        googleDlp: { disabled: false, credentials: undefined },
        presidio: { endpoint: undefined, timeoutMs: 60_000 },
        isProduction: false,
        nativePolicyEnforced: true,
      },
      // The tokenizer knobs default to "no local BPE directory" and the
      // application's own 10s remote-fetch ceiling.
      tokenizer: { bpeDirectory: undefined, fetchTimeoutMs: 10_000 },
      stripe: { secretKey: undefined },
      // Both absent is the application's own behaviour with `POSTHOG_KEY`
      // unset: this deployment chose not to run product analytics.
      productAnalytics: { key: undefined, host: undefined },
      gateway: { spendSettlementGraceMs: undefined },
      github: { appId: undefined, privateKey: undefined, host: undefined },
      processing: { metricShards: undefined, logShards: undefined },
      eventing: { foldCacheTtlSeconds: undefined },
      infrastructure: {
        redis: { configured: false, reason: "unconfigured", warnings: [] },
        groupQueue: {
          globalConcurrency: undefined,
          tenantConcurrencyCap: undefined,
          globalConcurrencyBudget: undefined,
          compression: "gzip",
          payloadCodec: "json",
        },
        storage: {
          backend: "s3",
          azureSpoolRetentionConfirmed: false,
          localFilesystemRoot: "/var/lib/langwatch/objects",
          s3: {
            bucket: undefined,
            endpoint: undefined,
            region: undefined,
            accessKeyId: undefined,
            secretAccessKey: undefined,
            sessionToken: undefined,
          },
        },
        outboundProxy: { https: undefined, http: undefined, noProxy: undefined },
      },
    });
  });

  describe("given a deployment that named a PostHog project", () => {
    /** @scenario "A deployment that configured PostHog delivers the milestone" */
    it("reads the key and host from the application's own two variables", () => {
      const config = resolveWorkerConfig({
        POSTHOG_KEY: "phc_test",
        POSTHOG_HOST: "https://eu.i.posthog.com",
      });

      expect(config.productAnalytics).toEqual({
        key: "phc_test",
        host: "https://eu.i.posthog.com",
      });
    });

    /** @scenario "The host is the deployment's own, never one invented here" */
    it("leaves an unnamed host absent rather than substituting a default", () => {
      expect(
        resolveWorkerConfig({ POSTHOG_KEY: "phc_test" }).productAnalytics.host,
      ).toBeUndefined();
    });

    /** @scenario "A deployment that configured no product analytics records nothing" */
    it("boots on an empty key the way the application boots on one", () => {
      expect(() => resolveWorkerConfig({ POSTHOG_KEY: "" })).not.toThrow();
    });
  });

  it("reads a semantic environment value from its process source", () => {
    const config = resolveWorkerConfig({ ENVIRONMENT: "production" });

    expect(config.environment).toBe("production");
    expect(config.nodeEnvironment).toBe("development");
  });

  it("parses tracing credentials at the process boundary without exposing them in errors", () => {
    const config = resolveWorkerConfig({
      LANGWATCH_API_KEY: "key-for-worker",
      LANGWATCH_ENDPOINT: "https://collector.example.test",
      LANGWATCH_PROCESSOR_TYPE: "simple",
    });

    expect(config.observability).toEqual({
      apiKey: "key-for-worker",
      endpoint: "https://collector.example.test",
      processorType: "simple",
    });
  });

  it("parses the production runtime mode used for Eventing diagnostics", () => {
    const config = resolveWorkerConfig({ NODE_ENV: "production" });

    expect(config.nodeEnvironment).toBe("production");
  });

  it("preserves the legacy worker logger compatibility spellings", () => {
    const config = resolveWorkerConfig({
      OTEL_SERVICE_NAME: "legacy-worker",
      PINO_LOG_LEVEL: "debug",
      PINO_CONSOLE_LEVEL: "warn",
      PINO_OTEL_ENABLED: "true",
    });

    expect(config.serviceName).toBe("legacy-worker");
    expect(config.logger).toEqual({
      format: undefined,
      level: "debug",
      consoleLevel: "warn",
      otelExportEnabled: true,
    });
  });

  it("preserves the Worker shutdown budget defaults and positive override", () => {
    expect(
      resolveWorkerConfig({ NODE_ENV: "production", ENVIRONMENT: "production" }).shutdown,
    ).toEqual({ processDeadlineMs: 45_000 });
    expect(resolveWorkerConfig({ SHUTDOWN_DRAIN_TIMEOUT_MS: "60000" }).shutdown).toEqual({
      processDeadlineMs: 80_000,
    });
    expect(resolveWorkerConfig({ SHUTDOWN_DRAIN_TIMEOUT_MS: "invalid" }).shutdown).toEqual({
      processDeadlineMs: 25_000,
    });
  });

  it("resolves Worker-private Redis, queue, storage, and proxy settings once", () => {
    const config = resolveWorkerConfig({
      REDIS_URL: "redis://redis.example.test:6379",
      REDIS_DB_INDEX: "4",
      GLOBAL_QUEUE_CONCURRENCY: "12",
      GROUP_QUEUE_ZSTD_WRITES_ENABLED: "true",
      GROUP_QUEUE_MSGPACK_WRITES_ENABLED: "true",
      LANGWATCH_DISPATCH_TENANT_CAP: "0",
      LANGWATCH_DISPATCH_GLOBAL_BUDGET: "48",
      S3_BUCKET_NAME: "worker-bucket",
      S3_ENDPOINT: "https://storage.example.test",
      S3_REGION: "eu-west-1",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-key",
      S3_SESSION_TOKEN: "session-token",
      LANGWATCH_LOCAL_STORAGE_PATH: "/worker/objects",
      HTTPS_PROXY: " https://proxy.example.test:8443 ",
      NO_PROXY: " internal.example.test ",
    });

    expect(config.infrastructure).toEqual({
      redis: {
        configured: true,
        mode: "standalone",
        url: "redis://redis.example.test:6379",
        db: 4,
        tls: undefined,
        warnings: [],
      },
      groupQueue: {
        globalConcurrency: 12,
        tenantConcurrencyCap: 0,
        globalConcurrencyBudget: 48,
        compression: "zstd",
        payloadCodec: "msgpack",
      },
      storage: {
        backend: "s3",
        azureSpoolRetentionConfirmed: false,
        localFilesystemRoot: "/worker/objects",
        s3: {
          bucket: "worker-bucket",
          endpoint: "https://storage.example.test",
          region: "eu-west-1",
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
          sessionToken: "session-token",
        },
      },
      outboundProxy: {
        https: "https://proxy.example.test:8443",
        http: undefined,
        noProxy: "internal.example.test",
      },
    });
  });

  it("preserves empty S3 credentials as the default AWS credential chain", () => {
    const config = resolveWorkerConfig({
      S3_BUCKET_NAME: "worker-bucket",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
      S3_SESSION_TOKEN: "",
    });

    expect(config.infrastructure.storage.s3).toEqual({
      bucket: "worker-bucket",
      endpoint: undefined,
      region: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      sessionToken: undefined,
    });
  });

  it("preserves the legacy S3 region fallback for explicit credentials and custom endpoints", () => {
    expect(
      resolveWorkerConfig({
        S3_ACCESS_KEY_ID: "access-key",
        S3_SECRET_ACCESS_KEY: "secret-key",
      }).infrastructure.storage.s3.region,
    ).toBe("auto");
    expect(
      resolveWorkerConfig({ S3_ENDPOINT: "https://minio.example.test" }).infrastructure.storage.s3
        .region,
    ).toBe("auto");
  });

  it("honours lower-case outbound-proxy compatibility variables", () => {
    const config = resolveWorkerConfig({
      https_proxy: "https://proxy.example.test",
      no_proxy: ".internal.example.test",
    });

    expect(config.infrastructure.outboundProxy).toEqual({
      https: "https://proxy.example.test",
      http: undefined,
      noProxy: ".internal.example.test",
    });
  });

  it("rejects invalid configuration before a worker graph can boot", () => {
    expect(() => resolveWorkerConfig({ ENVIRONMENT: "" })).toThrow(InvalidRuntimeConfigError);
  });

  it("fails closed when a deployment assigns the worker a web role", () => {
    expect(() => resolveWorkerConfig({ WORKER_PROCESS_ROLE: "web" })).toThrow(
      InvalidRuntimeConfigError,
    );
  });

  it("ignores the retired consumer knob: composition roots own that decision now", () => {
    expect(() => resolveWorkerConfig({ WORKER_EVENTING_CONSUMERS_ENABLED: "true" })).not.toThrow();
  });

  it("rejects an unknown stored-object backend before worker composition", () => {
    expect(() => resolveWorkerConfig({ STORED_OBJECTS_BACKEND: "gcs" })).toThrow(
      InvalidRuntimeConfigError,
    );
  });

  describe("when the deployment names itself SaaS", () => {
    /**
     * Every spelling the App accepts, and one it does not. The App reads the
     * same variable as `=== "1" || ?.toLowerCase() === "true"`, and this
     * process gates the cross-pipeline billable-events meter on the answer
     * while the App gates its own producer half on it. A worker that read
     * `yes` as SaaS would meter an install whose App configured no meter, and
     * one that refused `TRUE` would leave a SaaS install's billable events
     * counted by nobody. Neither disagreement fails loudly.
     */
    it.each([
      ["1", true],
      ["true", true],
      ["TRUE", true],
      ["True", true],
      ["yes", false],
      ["0", false],
      ["false", false],
      ["", false],
    ])("reads IS_SAAS=%j as %s", (value, expected) => {
      expect(resolveWorkerConfig({ IS_SAAS: value }).deployment.saas).toBe(expected);
    });

    it("is not SaaS where the variable is absent", () => {
      expect(resolveWorkerConfig({}).deployment.saas).toBe(false);
    });
  });

  it("carries the spend settlement grace unparsed, for the gateway package to bound", () => {
    // `settlementGraceMs` in @langwatch/gateway-server owns the parse, its
    // lower bound and the warning it logs, and the App's REST settlement
    // policy calls that same function on this same variable. A second parse
    // here is how the two ends of one grace window drift apart.
    expect(resolveWorkerConfig({ LW_SPEND_SETTLEMENT_GRACE_MS: "45000" }).gateway).toEqual({
      spendSettlementGraceMs: "45000",
    });
  });
});

describe("given the four privacy variables the ingestion path reads", () => {
  /** @scenario "The four privacy variables are read the way the application reads them" */
  it("carries the analysis endpoint and marks a production process as enforcing", () => {
    const config = resolveWorkerConfig({
      LANGEVALS_ENDPOINT: "http://langevals",
      NODE_ENV: "production",
    });

    expect(config.tracePrivacy.presidio.endpoint).toBe("http://langevals");
    expect(config.tracePrivacy.isProduction).toBe(true);
  });

  /** @scenario "The four privacy variables are read the way the application reads them" */
  it("turns the native floor off only for the application's own spelling", () => {
    expect(
      resolveWorkerConfig({ LANGWATCH_DATA_PRIVACY_ENFORCEMENT: "off" }).tracePrivacy
        .nativePolicyEnforced,
    ).toBe(false);
    expect(
      resolveWorkerConfig({ LANGWATCH_DATA_PRIVACY_ENFORCEMENT: "OFF" }).tracePrivacy
        .nativePolicyEnforced,
    ).toBe(true);
  });

  /** @scenario "Azure refuses until the operator asserts the lifecycle rule" */
  it("reads the Azure spool retention assertion the way the application reads it", () => {
    const confirmed = (value: string) =>
      resolveWorkerConfig({ AZURE_BLOB_SPOOL_RETENTION_CONFIRMED: value }).infrastructure.storage
        .azureSpoolRetentionConfirmed;

    // The application opts in for `1` or a case-insensitive `true`, and treats
    // every other spelling as "not confirmed" rather than refusing to boot.
    expect(confirmed("1")).toBe(true);
    expect(confirmed("true")).toBe(true);
    expect(confirmed("TRUE")).toBe(true);
    expect(confirmed("True")).toBe(true);
    expect(confirmed("0")).toBe(false);
    expect(confirmed("false")).toBe(false);
    expect(confirmed("yes")).toBe(false);
    expect(resolveWorkerConfig({}).infrastructure.storage.azureSpoolRetentionConfirmed).toBe(false);
  });

  /** @scenario "The four privacy variables are read the way the application reads them" */
  it("reads the DLP kill switch the way the application reads it, and no wider", () => {
    const disabled = (value: string) =>
      resolveWorkerConfig({ LANGWATCH_DISABLE_GOOGLE_DLP: value }).tracePrivacy.googleDlp.disabled;

    expect(disabled("true")).toBe(true);
    expect(disabled("false")).toBe(false);
    // The application treats every other spelling as "not disabled" rather
    // than refusing to boot, `1` included.
    expect(disabled("1")).toBe(false);
    expect(disabled("yes")).toBe(false);
  });

  /** @scenario "The four privacy variables are read the way the application reads them" */
  it("keeps the whole service-account document, and requires a project to build a client with", () => {
    const config = resolveWorkerConfig({
      GOOGLE_APPLICATION_CREDENTIALS: JSON.stringify({
        project_id: "privacy-project",
        client_email: "privacy@example.test",
        private_key: "private-key",
      }),
    });

    expect(config.tracePrivacy.googleDlp.credentials).toEqual({
      project_id: "privacy-project",
      client_email: "privacy@example.test",
      private_key: "private-key",
    });
  });

  /** @scenario "The four privacy variables are read the way the application reads them" */
  it("leaves DLP unavailable after an unusable document rather than failing an unrelated boot", () => {
    expect(
      resolveWorkerConfig({ GOOGLE_APPLICATION_CREDENTIALS: "{not-json" }).tracePrivacy.googleDlp
        .credentials,
    ).toBeUndefined();
    expect(
      resolveWorkerConfig({
        GOOGLE_APPLICATION_CREDENTIALS: JSON.stringify({ client_email: "privacy@example.test" }),
      }).tracePrivacy.googleDlp.credentials,
    ).toBeUndefined();
  });

  /** @scenario "The four privacy variables are read the way the application reads them" */
  it("reports why a document was unusable, so a boot can log it", () => {
    const failures: string[] = [];
    resolveWorkerTracePrivacyConfig(
      {
        tracePrivacy: {
          googleApplicationCredentials: "{not-json",
          googleDlpDisabled: undefined,
          langevalsEndpoint: undefined,
          dataPrivacyEnforcement: undefined,
        },
        nodeEnvironment: "development",
      },
      (failure) => failures.push(failure.reason),
    );
    resolveWorkerTracePrivacyConfig(
      {
        tracePrivacy: {
          googleApplicationCredentials: JSON.stringify({ project_id: "  " }),
          googleDlpDisabled: undefined,
          langevalsEndpoint: undefined,
          dataPrivacyEnforcement: undefined,
        },
        nodeEnvironment: "development",
      },
      (failure) => failures.push(failure.reason),
    );

    expect(failures).toEqual(["invalid-json", "missing-project-id"]);
  });
});
