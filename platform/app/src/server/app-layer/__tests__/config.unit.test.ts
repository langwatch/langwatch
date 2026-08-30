import { RedisConfigService } from "@langwatch/redis-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeEnvironmentConfig, resetEnvironmentConfigForTests } from "../../../env.mjs";
import {
  createAppConfigFromEnv,
  type ProcessRole,
  resolveGroupQueueProcessConfig,
  resolveLangyWorkerConfig,
  roleRunsWorkers,
  roleSatisfiesRunIn,
} from "../config";
import { resolveEvaluationExecutionConfig } from "~/runtime/evaluation-execution.config";
import { resolveScenarioChildParentEnvironment } from "~/runtime/worker/scenario-child-parent.config";
import { resolveLangevalsRuntimeConfig } from "~/runtime/langevals.config";
import { resolveStripeRuntimeConfig } from "~/runtime/app/stripe.runtime";

/**
 * `initializeEnvironmentConfig` installs once and ignores later calls — it is
 * `??=`, because a process has one environment and a second boot must not
 * silently replace it. A test that installs its own therefore has to clear the
 * previous one first, or it reads whichever case ran before it.
 *
 * Two describes did this for themselves and the rest did not, so the file's
 * answers depended on execution order: a case asserting
 * `GLOBAL_QUEUE_CONCURRENCY: "64"` was reading 200 from an environment
 * installed several describes earlier. Done once here so a new describe cannot
 * forget.
 */
beforeEach(() => {
  resetEnvironmentConfigForTests();
});

afterEach(() => {
  resetEnvironmentConfigForTests();
  initializeEnvironmentConfig(process.env);
});

describe("Stripe process configuration", () => {
  it("keeps the established SDK policy with the validated secret key", () => {
    expect(resolveStripeRuntimeConfig({ STRIPE_SECRET_KEY: "sk_test_process" })).toEqual({
      secretKey: "sk_test_process",
      apiVersion: "2024-04-10",
      maxNetworkRetries: 1,
      telemetry: true,
    });
  });
});

describe("Gateway virtual-key process configuration", () => {
  beforeEach(() => {
    resetEnvironmentConfigForTests();
  });

  afterEach(() => {
    resetEnvironmentConfigForTests();
    initializeEnvironmentConfig(process.env);
  });

  it("projects only LW_VIRTUAL_KEY_PEPPER into the composed app configuration", () => {
    initializeEnvironmentConfig({
      NODE_ENV: "test",
      BUILD_TIME: "1",
      SKIP_ENV_VALIDATION: "1",
      BASE_HOST: "http://localhost:5560",
      LW_VIRTUAL_KEY_PEPPER: "configured-virtual-key-pepper-32-bytes",
      CREDENTIALS_SECRET: "must-not-be-used-as-a-virtual-key-pepper",
      NEXTAUTH_SECRET: "must-not-be-used-as-a-virtual-key-pepper",
    });

    expect(createAppConfigFromEnv().virtualKeyPepper).toBe(
      "configured-virtual-key-pepper-32-bytes",
    );
  });
});

describe("Mailer private process configuration", () => {
  beforeEach(() => {
    resetEnvironmentConfigForTests();
  });

  afterEach(() => {
    resetEnvironmentConfigForTests();
    initializeEnvironmentConfig(process.env);
  });

  it.each(["web", "worker", "all"] as const)(
    "projects one immutable mail gateway for the %s process role",
    (processRole) => {
      initializeEnvironmentConfig({
        NODE_ENV: "test",
        BUILD_TIME: "1",
        SKIP_ENV_VALIDATION: "1",
        BASE_HOST: "https://tenant.example.test",
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_test",
      });

      expect(createAppConfigFromEnv({ processRole })).toMatchObject({
        processRole,
        mailer: {
          defaultFrom: "LangWatch <mailer@tenant.example.test>",
          provider: "resend",
          resend: { apiKey: "re_test" },
        },
      });
    },
  );
});

describe("Evaluation execution process configuration", () => {
  it("preserves the legacy default and parseInt handling", () => {
    expect(resolveEvaluationExecutionConfig({}).defaultConcurrency).toBe(10);
    expect(resolveEvaluationExecutionConfig({ EVAL_V3_CONCURRENCY: "0" }).defaultConcurrency).toBe(
      0,
    );
    expect(resolveEvaluationExecutionConfig({ EVAL_V3_CONCURRENCY: "-1" }).defaultConcurrency).toBe(
      -1,
    );
    expect(
      resolveEvaluationExecutionConfig({ EVAL_V3_CONCURRENCY: " 12workers" }).defaultConcurrency,
    ).toBe(12);
    expect(
      Number.isNaN(
        resolveEvaluationExecutionConfig({ EVAL_V3_CONCURRENCY: "" }).defaultConcurrency,
      ),
    ).toBe(true);
    expect(
      Number.isNaN(
        resolveEvaluationExecutionConfig({ EVAL_V3_CONCURRENCY: "not-a-number" })
          .defaultConcurrency,
      ),
    ).toBe(true);
  });

  it.each(["web", "worker", "migration", "all"] as const)(
    "projects the configured default for the %s process role",
    (processRole) => {
      const previous = process.env.EVAL_V3_CONCURRENCY;
      process.env.EVAL_V3_CONCURRENCY = "17";

      try {
        // `createAppConfigFromEnv` reads the INSTALLED environment, not
        // `process.env`, so the install has to happen after the mutation
        // above. This used to work only because some earlier describe had
        // installed one and the ordering happened to favour it.
        initializeEnvironmentConfig(process.env);

        expect(createAppConfigFromEnv({ processRole }).evaluationExecution).toEqual({
          defaultConcurrency: 17,
        });
      } finally {
        if (previous === undefined) {
          delete process.env.EVAL_V3_CONCURRENCY;
        } else {
          process.env.EVAL_V3_CONCURRENCY = previous;
        }
      }
    },
  );
});

describe("Langevals process configuration", () => {
  it("keeps the configured internal endpoint and transport defaults together", () => {
    expect(
      resolveLangevalsRuntimeConfig({ LANGEVALS_ENDPOINT: "http://langevals.internal:8000" }),
    ).toEqual({
      endpoint: "http://langevals.internal:8000",
      maxRetries: 1,
      timeoutMs: 120_000,
      // The payload ceilings travel with the transport for the same reason the
      // timeout does: a caller that can reach langevals still has to know what
      // it may send. `stagingThresholdBytes` has no default on purpose —
      // unset means "never stage", and a number here would turn staging on for
      // every deployment that never asked for it.
      payload: {
        stagingThresholdBytes: undefined,
        stagingTtlSeconds: 600,
        evaluationMaxPayloadBytes: 16_000_000,
        topicClusteringMaxPayloadBytes: 180_000_000,
      },
    });
  });

  it("leaves the transport unavailable when the endpoint is absent", () => {
    expect(resolveLangevalsRuntimeConfig({}).endpoint).toBeUndefined();
  });

  it("keeps an explicitly empty endpoint unavailable", () => {
    expect(resolveLangevalsRuntimeConfig({ LANGEVALS_ENDPOINT: "" }).endpoint).toBe("");
  });
});

describe("Scenario child parent environment", () => {
  it("projects only the child process allowlist", () => {
    expect(
      resolveScenarioChildParentEnvironment({
        PATH: "/bin",
        LANG: "en_US.UTF-8",
        NODE_EXTRA_CA_CERTS: "/certs/extra.pem",
        LANGWATCH_API_KEY: "must-not-pass-through",
      }),
    ).toEqual({
      path: "/bin",
      home: undefined,
      user: undefined,
      shell: undefined,
      lang: "en_US.UTF-8",
      lcAll: undefined,
      term: undefined,
      nodeCompileCache: undefined,
      corepackEnableDownloadPrompt: undefined,
      nodeExtraCaCerts: "/certs/extra.pem",
    });
  });
});

describe("Group Queue process configuration", () => {
  it("keeps malformed and absent values on the established queue defaults", () => {
    expect(
      resolveGroupQueueProcessConfig({
        globalConcurrency: "0",
        zstdWritesEnabled: "TRUE",
        msgpackWritesEnabled: "1",
        tenantConcurrencyCap: "-1",
        globalConcurrencyBudget: "not-a-number",
      }),
    ).toEqual({
      globalConcurrency: undefined,
      tenantConcurrencyCap: undefined,
      globalConcurrencyBudget: undefined,
      compression: "gzip",
      payloadCodec: "json",
    });
  });

  it("maps queue concurrency, codecs, and dispatch caps once into AppConfig", () => {
    initializeEnvironmentConfig({
      NODE_ENV: "test",
      BUILD_TIME: "1",
      SKIP_ENV_VALIDATION: "1",
      BASE_HOST: "http://localhost:5560",
      GLOBAL_QUEUE_CONCURRENCY: "64",
      GROUP_QUEUE_ZSTD_WRITES_ENABLED: "true",
      GROUP_QUEUE_MSGPACK_WRITES_ENABLED: "true",
      LANGWATCH_DISPATCH_TENANT_CAP: "0",
      LANGWATCH_DISPATCH_GLOBAL_BUDGET: "320",
    });

    expect(createAppConfigFromEnv().groupQueue).toEqual({
      globalConcurrency: 64,
      tenantConcurrencyCap: 0,
      globalConcurrencyBudget: 320,
      compression: "zstd",
      payloadCodec: "msgpack",
    });
  });

  it("passes cluster configuration through while Redis pins its database to zero", () => {
    initializeEnvironmentConfig({
      NODE_ENV: "test",
      BUILD_TIME: "1",
      SKIP_ENV_VALIDATION: "1",
      BASE_HOST: "http://localhost:5560",
      REDIS_CLUSTER_ENDPOINTS: "one:6379,two:6380",
      REDIS_DB_INDEX: "3",
    });

    const config = createAppConfigFromEnv();
    const resolution = new RedisConfigService().resolve({
      clusterEndpoints: config.redisClusterEndpoints,
      dbIndex: config.redisDbIndex,
    });

    expect(resolution).toMatchObject({
      configured: true,
      mode: "cluster",
      db: 0,
      endpoints: [
        { host: "one", port: 6379 },
        { host: "two", port: 6380 },
      ],
    });
    expect(resolution.warnings).toHaveLength(1);
  });
});

describe("resolveLangyWorkerConfig", () => {
  it("returns no worker config when both values are absent", () => {
    expect(resolveLangyWorkerConfig({ agentUrl: void 0, internalSecret: void 0 })).toBeUndefined();
  });

  it("returns complete semantic worker config", () => {
    expect(
      resolveLangyWorkerConfig({
        agentUrl: "https://agent.internal",
        internalSecret: "secret",
      }),
    ).toEqual({
      agentUrl: "https://agent.internal",
      internalSecret: "secret",
    });
  });

  it.each([
    { agentUrl: "https://agent.internal", internalSecret: void 0 },
    { agentUrl: void 0, internalSecret: "secret" },
  ])("rejects partial worker config", (input) => {
    expect(() => resolveLangyWorkerConfig(input)).toThrow(
      "OPENCODE_AGENT_URL and LANGY_INTERNAL_SECRET must be configured together",
    );
  });
});

describe("roleRunsWorkers", () => {
  describe("given a role that hosts the worker stack", () => {
    it("returns true for the dedicated worker role", () => {
      expect(roleRunsWorkers("worker")).toBe(true);
    });

    it("returns true for the in-process 'all' role (dev single-process mode)", () => {
      expect(roleRunsWorkers("all")).toBe(true);
    });
  });

  describe("given a role that does not host the worker stack", () => {
    it("returns false for the web role", () => {
      expect(roleRunsWorkers("web")).toBe(false);
    });

    it("returns false for the migration role", () => {
      expect(roleRunsWorkers("migration")).toBe(false);
    });

    it("returns false when the role is undefined (dispatch-only)", () => {
      expect(roleRunsWorkers(undefined)).toBe(false);
    });
  });

  describe("given every ProcessRole variant", () => {
    /** @scenario "Each process installs only its AuthZ responsibilities" */
    /** @scenario roleRunsWorkers treats worker and all as worker-hosting roles */
    it("treats exactly worker and all as worker-hosting roles", () => {
      const roles: ProcessRole[] = ["web", "worker", "migration", "all"];
      const hosting = roles.filter(roleRunsWorkers);
      expect(hosting).toEqual(["worker", "all"]);
    });
  });
});

describe("roleSatisfiesRunIn", () => {
  describe("given a subscriber with no runIn filter", () => {
    it("runs under any role (undefined filter means run everywhere)", () => {
      expect(roleSatisfiesRunIn({ runIn: undefined, processRole: "web" })).toBe(true);
      expect(roleSatisfiesRunIn({ runIn: undefined, processRole: "worker" })).toBe(true);
      expect(roleSatisfiesRunIn({ runIn: undefined, processRole: "all" })).toBe(true);
    });
  });

  describe("given the process role is undefined", () => {
    it("does not exclude the subscriber (backwards-compatible run-everywhere)", () => {
      expect(roleSatisfiesRunIn({ runIn: ["worker"], processRole: undefined })).toBe(true);
    });
  });

  describe("given the in-process 'all' role", () => {
    // The regression the P0 fix guards: a worker-only subscriber MUST run under
    // "all", otherwise `pnpm dev` boots the worker stack but every
    // runIn-gated subscriber is silently skipped.
    it("satisfies a worker-only runIn filter", () => {
      expect(roleSatisfiesRunIn({ runIn: ["worker"], processRole: "all" })).toBe(true);
    });

    it("satisfies a web+worker runIn filter", () => {
      expect(roleSatisfiesRunIn({ runIn: ["web", "worker"], processRole: "all" })).toBe(true);
    });

    it("satisfies even a web-only runIn filter (all plays every role)", () => {
      expect(roleSatisfiesRunIn({ runIn: ["web"], processRole: "all" })).toBe(true);
    });
  });

  describe("given a dedicated role and a matching filter", () => {
    it("runs a worker subscriber under the worker role", () => {
      expect(roleSatisfiesRunIn({ runIn: ["worker"], processRole: "worker" })).toBe(true);
    });

    it("runs a web+worker subscriber under the web role", () => {
      expect(roleSatisfiesRunIn({ runIn: ["web", "worker"], processRole: "web" })).toBe(true);
    });
  });

  describe("given a dedicated role and a non-matching filter", () => {
    it("excludes a worker-only subscriber under the web role", () => {
      expect(roleSatisfiesRunIn({ runIn: ["worker"], processRole: "web" })).toBe(false);
    });

    it("excludes a web-only subscriber under the worker role", () => {
      expect(roleSatisfiesRunIn({ runIn: ["web"], processRole: "worker" })).toBe(false);
    });

    it("excludes a worker-only subscriber under the migration role", () => {
      expect(roleSatisfiesRunIn({ runIn: ["worker"], processRole: "migration" })).toBe(false);
    });
  });
});
