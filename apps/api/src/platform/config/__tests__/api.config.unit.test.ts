import { getLatestOpenAIChatFlagship } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";
import {
  apiLoggerConfiguration,
  apiObservabilityConfiguration,
  resolveApiConfig,
} from "../api.config";

/**
 * The fallback model, derived rather than written down.
 *
 * A literal here would pin the assertions to whichever model was newest the
 * day they were written, and the registry advances: the fact under test is
 * that an unconfigured deployment gets the CURRENT flagship, not that it gets
 * a particular one.
 */
const REGISTRY_FLAGSHIP_MODEL = getLatestOpenAIChatFlagship() ?? "openai/gpt-5";

describe("API process configuration", () => {
  it("parses the listener and drain settings once at executable composition", () => {
    expect(
      resolveApiConfig({
        ENVIRONMENT: "production",
        API_HOST: "127.0.0.1",
        API_PORT: "6560",
        API_HTTP_DRAIN_GRACE_MS: "9000",
      }),
    ).toEqual({
      processRole: "web",
      environment: "production",
      nodeEnvironment: "development",
      serviceName: "langwatch-api",
      serviceVersion: undefined,
      host: "127.0.0.1",
      port: 6560,
      httpDrainGraceMs: 9000,
      shutdown: { processDeadlineMs: 24_000 },
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
      // The OTLP collector this process pushes its own metrics to, which this
      // deployment named none of: no endpoint and the switch off, which is
      // what makes the export absent rather than a reader pointed nowhere.
      otlpMetrics: {
        endpoint: undefined,
        enabled: false,
        headers: {},
        resourceAttributes: {},
        serviceName: "langwatch-api",
        deploymentEnvironment: "production",
      },
      instanceAdminApiKey: undefined,
      apiKeyPepper: undefined,
      // The credentials this process reads and never logs. Every one of them
      // is an unvalidated optional string on purpose: an operator who exports
      // a variable blank has NOT configured a secret, and refusing the whole
      // boot over it would refuse deployments that run none of these surfaces.
      // What blank MEANS is each reader's own rule, and lives with it.
      storedSecretEncryptionKey: undefined,
      virtualKeyPepper: undefined,
      gatewayInternalSecret: undefined,
      gatewayJwtSecret: undefined,
      langyInternalSecret: undefined,
      // The directory-sync block: no Auth0 secret configured, and D08's
      // grants path off, which is the flag's own default.
      scim: { auth0WebhookSecret: undefined, provenOffboarding: false },
      metricsApiKey: undefined,
      spendSettlementGraceMs: undefined,
      browserSession: undefined,
      authz: {
        epochCacheEnabled: false,
        demoProjectId: undefined,
        demoProjectUserId: undefined,
      },
      // The rollout switches this deployment set, which is none: an empty
      // override map and an empty force-enable set, so every flag answers from
      // the registry default.
      featureFlags: { overrides: new Map(), forceEnabled: new Set() },
      infrastructure: {
        database: { url: undefined },
        clickhouse: {
          url: undefined,
          langwatchQl: undefined,
          privateRoutes: [],
          poolSizing: {
            override: undefined,
            replicas: undefined,
            serverMaxConcurrentQueries: undefined,
            serverNodes: undefined,
            clientsPerProcess: undefined,
          },
        },
        execution: {
          nlpServiceUrl: undefined,
          langevalsEndpoint: undefined,
          publicBaseUrl: undefined,
          langwatchEndpoint: undefined,
          // Never blank, even here: a deployment that overrides no model still
          // has to be able to run a scenario whose target names none.
          defaultModel: REGISTRY_FLAGSHIP_MODEL,
        },
        // The gateway's own three facts, and the environment it reads a system
        // provider's credential from — which is this call's source, filtered to
        // its string entries, because that is the only environment this module
        // is given.
        modelProvider: {
          isSaas: false,
          blockLocalHttpCalls: false,
          allowedProxyHosts: [],
          environment: {
            ENVIRONMENT: "production",
            API_HOST: "127.0.0.1",
            API_PORT: "6560",
            API_HTTP_DRAIN_GRACE_MS: "9000",
          },
        },
        // Blank rather than absent: an install that registered no GitHub App
        // has none of the five, and the feature's own `configured` flag is
        // what turns that into "not connected" rather than a failure.
        github: {
          appId: "",
          privateKey: "",
          appSlug: "",
          webhookSecret: "",
          host: undefined,
        },
        // The object storage this deployment addresses its externalized bytes
        // in. Absent everywhere is not "use the shared bucket": it is the
        // documented single-replica filesystem fallback, which the destination
        // policy owns and this module only supplies the root for.
        storedObjects: {
          backend: undefined,
          localFilesystemRoot: undefined,
          s3: {
            bucket: undefined,
            endpoint: undefined,
            region: undefined,
            accessKeyId: undefined,
            secretAccessKey: undefined,
            sessionToken: undefined,
          },
          // Read but unconfigured: the Azure driver is registered as a lazy
          // factory, so an install with no Azure block never resolves these.
          azure: {
            backend: undefined,
            authMode: undefined,
            accountName: undefined,
            accountKey: undefined,
            container: undefined,
            endpoint: undefined,
            authorityHost: undefined,
            tokenAudience: undefined,
            allowInsecureTokenEndpointForTests: false,
            identity: {
              tenantId: undefined,
              clientId: undefined,
              federatedTokenFile: undefined,
            },
          },
          routes: new Map(),
        },
        redis: { configured: false, reason: "unconfigured", warnings: [] },
        groupQueue: {
          globalConcurrency: undefined,
          tenantConcurrencyCap: undefined,
          globalConcurrencyBudget: undefined,
          compression: "gzip",
          payloadCodec: "json",
        },
      },
    });
  });

  describe("when the execution addresses are configured", () => {
    it("reads the NLP engine, the evaluator service and the deployment's public origin", () => {
      const config = resolveApiConfig({
        LANGWATCH_NLP_SERVICE: "http://nlp.example.test:5561",
        LANGEVALS_ENDPOINT: "http://langevals.example.test",
        BASE_HOST: "https://app.example.test",
      });

      expect(config.infrastructure.execution).toEqual({
        nlpServiceUrl: "http://nlp.example.test:5561",
        langevalsEndpoint: "http://langevals.example.test",
        publicBaseUrl: "https://app.example.test",
        langwatchEndpoint: undefined,
        defaultModel: REGISTRY_FLAGSHIP_MODEL,
      });
    });

    it("treats a blank export as unconfigured rather than as an empty address", () => {
      const config = resolveApiConfig({
        LANGWATCH_NLP_SERVICE: "  ",
        LANGEVALS_ENDPOINT: "  ",
        BASE_HOST: "",
      });

      // A blank value is not an address: composed as one it would produce a URL
      // parse failure at the first run instead of the configuration gap that
      // caused it.
      expect(config.infrastructure.execution).toEqual({
        nlpServiceUrl: undefined,
        langevalsEndpoint: undefined,
        publicBaseUrl: undefined,
        langwatchEndpoint: undefined,
        defaultModel: REGISTRY_FLAGSHIP_MODEL,
      });
    });
  });

  describe("when a scenario run's child environment is configured", () => {
    it("reads the ingestion origin a prepared child reports its own events to", () => {
      const config = resolveApiConfig({
        LANGWATCH_ENDPOINT: "https://ingest.example.test",
      });

      // The SAME variable this process's own telemetry names, which is what a
      // prepared child was handed before this module existed. Absent it would
      // fall back to the SDK default — somebody else's deployment.
      expect(config.infrastructure.execution.langwatchEndpoint).toBe("https://ingest.example.test");
    });

    it("takes the deployment's model override for a target that names none", () => {
      const config = resolveApiConfig({
        LANGWATCH_DEFAULT_MODEL: "openai/gpt-5-mini",
      });

      expect(config.infrastructure.execution.defaultModel).toBe("openai/gpt-5-mini");
    });

    it("falls back to the registry flagship rather than to an empty model", () => {
      const config = resolveApiConfig({ LANGWATCH_DEFAULT_MODEL: "  " });

      // A blank override is not a model: carried to a provider as one it names
      // a model called "", which fails at the child rather than here.
      expect(config.infrastructure.execution.defaultModel).toBe(REGISTRY_FLAGSHIP_MODEL);
    });
  });

  describe("when the API-key pepper is configured", () => {
    it("reads it from the same two variables, in the same order, as the cipher key", () => {
      expect(resolveApiConfig({ CREDENTIALS_SECRET: "from-credentials" }).apiKeyPepper).toBe(
        "from-credentials",
      );
      expect(resolveApiConfig({ NEXTAUTH_SECRET: "from-nextauth" }).apiKeyPepper).toBe(
        "from-nextauth",
      );
      expect(
        resolveApiConfig({ CREDENTIALS_SECRET: "wins", NEXTAUTH_SECRET: "loses" }).apiKeyPepper,
      ).toBe("wins");
      expect(resolveApiConfig({}).apiKeyPepper).toBeUndefined();
    });

    it("carries the value through verbatim, because it is used as an HMAC key", () => {
      const raw = "  0f0f  ";

      expect(resolveApiConfig({ CREDENTIALS_SECRET: raw }).apiKeyPepper).toBe(raw);
    });
  });

  describe("when the AuthZ switches are set", () => {
    it("reads the epoch cache the way every other tier reads it", () => {
      expect(resolveApiConfig({ AUTHZ_EPOCH_CACHE: "1" }).authz.epochCacheEnabled).toBe(true);
      expect(resolveApiConfig({ AUTHZ_EPOCH_CACHE: "true" }).authz.epochCacheEnabled).toBe(true);
      expect(resolveApiConfig({ AUTHZ_EPOCH_CACHE: "0" }).authz.epochCacheEnabled).toBe(false);
      expect(resolveApiConfig({}).authz.epochCacheEnabled).toBe(false);
    });

    it("ignores a value neither tier treats as on, rather than refusing the boot", () => {
      expect(resolveApiConfig({ AUTHZ_EPOCH_CACHE: "yes" }).authz.epochCacheEnabled).toBe(false);
    });

    it("reads a blank demo project as no demo project rather than as the empty id", () => {
      expect(resolveApiConfig({ DEMO_PROJECT_ID: "project-1" }).authz.demoProjectId).toBe(
        "project-1",
      );
      expect(resolveApiConfig({ DEMO_PROJECT_ID: "   " }).authz.demoProjectId).toBeUndefined();
      expect(resolveApiConfig({}).authz.demoProjectId).toBeUndefined();
    });
  });

  describe("when the directory-sync switches are set", () => {
    it("reads the Auth0 intake secret verbatim, because it is compared byte for byte", () => {
      const raw = "  shared-secret  ";

      expect(resolveApiConfig({ AUTH0_SCIM_WEBHOOK_SECRET: raw }).scim.auth0WebhookSecret).toBe(
        raw,
      );
      expect(resolveApiConfig({}).scim.auth0WebhookSecret).toBeUndefined();
    });

    it("leaves D08's grants offboarding off unless a deployment turns it on", () => {
      expect(resolveApiConfig({}).scim.provenOffboarding).toBe(false);
      expect(resolveApiConfig({ SCIM_V2_GRANTS: "1" }).scim.provenOffboarding).toBe(true);
      expect(resolveApiConfig({ SCIM_V2_GRANTS: "true" }).scim.provenOffboarding).toBe(true);
      expect(resolveApiConfig({ SCIM_V2_GRANTS: "0" }).scim.provenOffboarding).toBe(false);
    });
  });

  it("carries the instance administrator credential through the process's one environment read", () => {
    expect(
      resolveApiConfig({ LANGWATCH_INSTANCE_ADMIN_API_KEY: "  instance-admin-secret  " })
        .instanceAdminApiKey,
    ).toBe("  instance-admin-secret  ");
    expect(resolveApiConfig({}).instanceAdminApiKey).toBeUndefined();
  });

  it("boots with a blank instance administrator credential rather than refusing the process", () => {
    expect(resolveApiConfig({ LANGWATCH_INSTANCE_ADMIN_API_KEY: "" }).instanceAdminApiKey).toBe("");
  });

  it("gives the whole shutdown sequence more budget than the listener drain alone", () => {
    expect(resolveApiConfig({ API_HTTP_DRAIN_GRACE_MS: "9000" }).shutdown.processDeadlineMs).toBe(
      24_000,
    );
    expect(
      resolveApiConfig({ API_HTTP_DRAIN_GRACE_MS: "9000", API_SHUTDOWN_DEADLINE_MS: "12000" })
        .shutdown.processDeadlineMs,
    ).toBe(12_000);
  });

  it("rejects a shutdown deadline that would abort every drain immediately", () => {
    expect(() => resolveApiConfig({ API_SHUTDOWN_DEADLINE_MS: "0" })).toThrow(
      "Invalid api configuration",
    );
  });

  it("rejects invalid executable ports before a listener is constructed", () => {
    expect(() => resolveApiConfig({ API_PORT: "0" })).toThrow("Invalid api configuration");
  });

  it("fails closed when a deployment tries to assign the API a worker role", () => {
    expect(() => resolveApiConfig({ API_PROCESS_ROLE: "worker" })).toThrow(
      "Invalid api configuration",
    );
  });

  it("uses standalone compatibility aliases in deterministic precedence", () => {
    expect(
      resolveApiConfig({ API_PORT: "6560", LANGWATCH_API_PORT: "6561", PORT: "6562" }).port,
    ).toBe(6560);
    expect(resolveApiConfig({ LANGWATCH_API_PORT: "6561", PORT: "6562" }).port).toBe(6561);
    expect(resolveApiConfig({ PORT: "6562" }).port).toBe(6562);
  });

  it("projects parsed logger and telemetry settings without retaining the source", () => {
    const config = resolveApiConfig({
      NODE_ENV: "production",
      ENVIRONMENT: "eu-west",
      API_SERVICE_NAME: "api-edge",
      SERVICE_VERSION: "build-42",
      LOG_FORMAT: "json",
      LOG_LEVEL: "info",
      LOG_CONSOLE_LEVEL: "warn",
      LOG_OTEL_EXPORT_ENABLED: "true",
      LANGWATCH_API_KEY: "sk-lw-test",
      LANGWATCH_ENDPOINT: "https://telemetry.example.test",
      LANGWATCH_PROCESSOR_TYPE: "simple",
    });

    expect(apiLoggerConfiguration(config)).toMatchObject({
      environment: "production",
      format: "json",
      level: "info",
      consoleLevel: "warn",
      otelExportEnabled: true,
      serviceName: "api-edge",
      serviceVersion: "build-42",
      deploymentEnvironment: "eu-west",
    });
    expect(apiObservabilityConfiguration(config)).toMatchObject({
      serviceName: "api-edge",
      loggerName: "api-edge",
      setup: {
        langwatch: {
          apiKey: "sk-lw-test",
          endpoint: "https://telemetry.example.test",
          processorType: "simple",
        },
        attributes: {
          "deployment.environment.name": "eu-west",
          "service.version": "build-42",
        },
      },
    });
  });

  it("carries the Postgres connection the process composes its guarded client from", () => {
    expect(
      resolveApiConfig({ DATABASE_URL: "postgresql://localhost/langwatch" }).infrastructure
        .database,
    ).toEqual({ url: "postgresql://localhost/langwatch" });
  });

  it("leaves the database unconfigured rather than refusing a process that needs none", () => {
    expect(resolveApiConfig({}).infrastructure.database).toEqual({ url: undefined });
  });

  it("carries the stored-secret key the process builds its cipher from", () => {
    expect(
      resolveApiConfig({ CREDENTIALS_SECRET: "0f".repeat(32) }).storedSecretEncryptionKey,
    ).toBe("0f".repeat(32));
  });

  it("falls back to the second name the platform app has always accepted for it", () => {
    expect(resolveApiConfig({ NEXTAUTH_SECRET: "a1".repeat(32) }).storedSecretEncryptionKey).toBe(
      "a1".repeat(32),
    );
    expect(
      resolveApiConfig({
        CREDENTIALS_SECRET: "0f".repeat(32),
        NEXTAUTH_SECRET: "a1".repeat(32),
      }).storedSecretEncryptionKey,
    ).toBe("0f".repeat(32));
  });

  it("leaves the key unconfigured rather than refusing a process that composes no secrets", () => {
    expect(resolveApiConfig({}).storedSecretEncryptionKey).toBeUndefined();
    expect(resolveApiConfig({ CREDENTIALS_SECRET: "" }).storedSecretEncryptionKey).toBe("");
  });

  it("carries the metrics credential through the process's one environment read", () => {
    expect(resolveApiConfig({ METRICS_API_KEY: "scrape-me" }).metricsApiKey).toBe("scrape-me");
  });

  it("leaves the metrics credential unconfigured rather than refusing a process that serves none", () => {
    expect(resolveApiConfig({}).metricsApiKey).toBeUndefined();
    expect(resolveApiConfig({ METRICS_API_KEY: "" }).metricsApiKey).toBe("");
  });

  it("resolves Redis and Group Queue settings before API composition", () => {
    const config = resolveApiConfig({
      REDIS_URL: "redis://redis.example.test:6379",
      REDIS_DB_INDEX: "4",
      GLOBAL_QUEUE_CONCURRENCY: "12",
      GROUP_QUEUE_ZSTD_WRITES_ENABLED: "true",
      GROUP_QUEUE_MSGPACK_WRITES_ENABLED: "true",
      LANGWATCH_DISPATCH_TENANT_CAP: "0",
      LANGWATCH_DISPATCH_GLOBAL_BUDGET: "48",
    });

    expect(config.infrastructure).toEqual({
      database: { url: undefined },
      clickhouse: {
        url: undefined,
        langwatchQl: undefined,
        privateRoutes: [],
        poolSizing: {
          override: undefined,
          replicas: undefined,
          serverMaxConcurrentQueries: undefined,
          serverNodes: undefined,
          clientsPerProcess: undefined,
        },
      },
      execution: {
        nlpServiceUrl: undefined,
        langevalsEndpoint: undefined,
        publicBaseUrl: undefined,
        langwatchEndpoint: undefined,
        defaultModel: REGISTRY_FLAGSHIP_MODEL,
      },
      modelProvider: {
        isSaas: false,
        blockLocalHttpCalls: false,
        allowedProxyHosts: [],
        environment: {
          REDIS_URL: "redis://redis.example.test:6379",
          REDIS_DB_INDEX: "4",
          GLOBAL_QUEUE_CONCURRENCY: "12",
          GROUP_QUEUE_ZSTD_WRITES_ENABLED: "true",
          GROUP_QUEUE_MSGPACK_WRITES_ENABLED: "true",
          LANGWATCH_DISPATCH_TENANT_CAP: "0",
          LANGWATCH_DISPATCH_GLOBAL_BUDGET: "48",
        },
      },
      github: {
        appId: "",
        privateKey: "",
        appSlug: "",
        webhookSecret: "",
        host: undefined,
      },
      redis: {
        configured: true,
        mode: "standalone",
        url: "redis://redis.example.test:6379",
        db: 4,
        tls: undefined,
        warnings: [],
      },
      storedObjects: {
        backend: undefined,
        localFilesystemRoot: undefined,
        s3: {
          bucket: undefined,
          endpoint: undefined,
          region: undefined,
          accessKeyId: undefined,
          secretAccessKey: undefined,
          sessionToken: undefined,
        },
        azure: {
          backend: undefined,
          authMode: undefined,
          accountName: undefined,
          accountKey: undefined,
          container: undefined,
          endpoint: undefined,
          authorityHost: undefined,
          tokenAudience: undefined,
          allowInsecureTokenEndpointForTests: false,
          identity: {
            tenantId: undefined,
            clientId: undefined,
            federatedTokenFile: undefined,
          },
        },
        routes: new Map(),
      },
      groupQueue: {
        globalConcurrency: 12,
        tenantConcurrencyCap: 0,
        globalConcurrencyBudget: 48,
        compression: "zstd",
        payloadCodec: "msgpack",
      },
    });
  });

  /**
   * The self-ingest refusal, at the boundary that owns it.
   *
   * `assertObservabilityDoesNotSelfIngest` is tested exhaustively in
   * `@langwatch/config`; what belongs here is the WIRING — that this process
   * hands the guard its own three addresses, and that a boot which would loop
   * refuses before anything is composed.
   */
  describe("when the observability exporter is configured", () => {
    /** @scenario "A process pointed at its own ingest refuses to boot" */
    it("refuses a key exporting to this deployment's public origin", () => {
      expect(() =>
        resolveApiConfig({
          LANGWATCH_API_KEY: "sk-lw-a-real-looking-key",
          LANGWATCH_ENDPOINT: "https://app.example.test",
          BASE_HOST: "https://app.example.test",
        }),
      ).toThrow(/LANGWATCH_API_KEY is set and LANGWATCH_ENDPOINT resolves to app\.example\.test/);
    });

    /** @scenario "A process pointed at its own ingest refuses to boot" */
    it("refuses a key exporting to the port this process listens at", () => {
      expect(() =>
        resolveApiConfig({
          API_PORT: "5560",
          LANGWATCH_API_KEY: "sk-lw-a-real-looking-key",
          LANGWATCH_ENDPOINT: "http://localhost:5560",
        }),
      ).toThrow(/API_HOST\/API_PORT/);
    });

    /** @scenario "The refusal names the variables and never the key" */
    it("names the variables and never the key", () => {
      let raised: unknown;
      try {
        resolveApiConfig({
          LANGWATCH_API_KEY: "sk-lw-secret-value",
          LANGWATCH_ENDPOINT: "https://app.example.test",
          NEXTAUTH_URL: "https://app.example.test",
        });
      } catch (error) {
        raised = error;
      }

      expect(raised).toBeInstanceOf(Error);
      expect((raised as Error).message).toContain("NEXTAUTH_URL");
      expect((raised as Error).message).not.toContain("sk-lw-secret-value");
    });

    /** @scenario "A process exporting to a different LangWatch install boots" */
    it("accepts a key exporting to a different LangWatch install", () => {
      const config = resolveApiConfig({
        LANGWATCH_API_KEY: "sk-lw-a-real-looking-key",
        LANGWATCH_ENDPOINT: "https://app.langwatch.ai",
        BASE_HOST: "https://app.example.test",
        NEXTAUTH_URL: "https://app.example.test",
      });

      expect(config.observability.endpoint).toBe("https://app.langwatch.ai");
    });

    /** @scenario "A process with no observability key boots whatever the endpoint says" */
    it("accepts no key at all, whatever the endpoint names", () => {
      const config = resolveApiConfig({
        LANGWATCH_ENDPOINT: "https://app.example.test",
        BASE_HOST: "https://app.example.test",
      });

      expect(config.observability.apiKey).toBeUndefined();
    });
  });

  /**
   * The outbound mail gateway, resolved the way the worker resolves its own.
   *
   * `BASE_HOST` is what makes the whole leaf resolvable, and it is bound ONCE
   * — as `infrastructure.execution.publicBaseUrl` — so what is pinned here is
   * that the mail leaf reads it from there rather than binding a second copy
   * that could answer differently.
   */
  describe("the outbound mail gateway", () => {
    describe("given a deployment that named no BASE_HOST", () => {
      it("resolves no mail at all, even with a provider credential set", () => {
        const config = resolveApiConfig({ SENDGRID_API_KEY: "sg-key" });

        expect(config.mail).toBeUndefined();
      });
    });

    describe("given a deployment that named a BASE_HOST", () => {
      it("takes the host from the one variable the rest of the process reads", () => {
        const config = resolveApiConfig({ BASE_HOST: "https://app.example.test" });

        expect(config.mail?.baseHost).toBe("https://app.example.test");
        expect(config.infrastructure.execution.publicBaseUrl).toBe("https://app.example.test");
      });

      it("derives the sender from the host when the deployment named none", () => {
        const config = resolveApiConfig({ BASE_HOST: "https://app.example.test" });

        expect(config.mail?.mailer.defaultFrom).toContain("app.example.test");
      });

      it("keeps the sender the deployment named", () => {
        const config = resolveApiConfig({
          BASE_HOST: "https://app.example.test",
          EMAIL_DEFAULT_FROM: "LangWatch <no-reply@acme.test>",
        });

        expect(config.mail?.mailer.defaultFrom).toBe("LangWatch <no-reply@acme.test>");
      });

      it("carries every gateway credential the four transports are selected on", () => {
        const config = resolveApiConfig({
          BASE_HOST: "https://app.example.test",
          EMAIL_PROVIDER: "smtp",
          SMTP_HOST: "smtp.acme.test",
          SMTP_PORT: "587",
          SMTP_USER: "mailer",
          SMTP_PASSWORD: "smtp-secret",
          SENDGRID_API_KEY: "sg-key",
          RESEND_API_KEY: "re-key",
        });

        expect(config.mail?.mailer).toMatchObject({
          provider: "smtp",
          smtp: { host: "smtp.acme.test", port: "587", user: "mailer", password: "smtp-secret" },
          sendgrid: { apiKey: "sg-key" },
          resend: { apiKey: "re-key" },
        });
      });

      it("reads USE_AWS_SES by presence, as every deployment already sets it", () => {
        // Not a boolean. `USE_AWS_SES=false` selects SES on the platform
        // application and on the worker, and one process disagreeing would
        // send the same deployment's mail through two different gateways.
        const config = resolveApiConfig({
          BASE_HOST: "https://app.example.test",
          USE_AWS_SES: "false",
        });

        expect(config.mail?.mailer.ses.enabled).toBe(true);
      });
    });
  });
});
