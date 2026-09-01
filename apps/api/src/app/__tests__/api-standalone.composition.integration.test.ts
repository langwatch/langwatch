import { AgentService } from "@langwatch/agent-contract";
import { ApiKeyService } from "@langwatch/api-key-contract";
import { AuthService } from "@langwatch/auth-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { OrganizationService } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { SecretService } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";
import { ApiMetricsPort, ApiReadinessPort } from "../../api-process.lifecycle";
import { ApiFeatureDrainPort, ApiProcessGraphPort } from "../../api.process";
import {
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
} from "../api-auth.composition";
import {
  API_UNAVAILABLE_PRODUCT_ADAPTERS,
  ApiStandaloneComposition,
  type ApiStandaloneCompositionOptions,
} from "../api-standalone.composition";
import { resolveApiConfig, type ApiConfig } from "../../platform/config/api.config";

function ephemeralConfig(source: Readonly<Record<string, unknown>> = {}): ApiConfig {
  return {
    ...resolveApiConfig({ NODE_ENV: "test", API_HOST: "127.0.0.1", ...source }),
    port: 0,
  };
}

describe("ApiStandaloneComposition", () => {
  describe("when no host supplied product service adapters", () => {
    it("still serves the process-owned health route from a real listener", async () => {
      const process = await ApiStandaloneComposition.create().compose({
        config: ephemeralConfig(),
        graph: new TestGraph(),
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });

      const address = await process.start();
      if (!address)
        throw new Error("The standalone API process did not report a listener address.");

      const health = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      expect(health.status).toBe(204);
      const head = await fetch(`http://127.0.0.1:${address.port}/api/health`, { method: "HEAD" });
      expect(head.status).toBe(204);

      await process.close();
      await expect(fetch(`http://127.0.0.1:${address.port}/api/health`)).rejects.toThrow();
    });

    /** @scenario "The unavailable-adapter list names only the Better Auth transport" */
    it("names every adapter it is still waiting on rather than leaving the gap implicit", () => {
      expect(API_UNAVAILABLE_PRODUCT_ADAPTERS).toEqual([
        "The deployment's Better Auth browser-session transport",
      ]);
    });

    /** @scenario "The unavailable-adapter list names only the Better Auth transport" */
    it("stops naming IdentityEmailService, now that it composes one over its own client", () => {
      const named = API_UNAVAILABLE_PRODUCT_ADAPTERS.join("\n");

      expect(named).not.toMatch(/IdentityEmailService|identifier email|read fork/i);
    });

    it("stops naming the instance administrator credential and the rate limiter it now owns", () => {
      const named = API_UNAVAILABLE_PRODUCT_ADAPTERS.join("\n");

      expect(named).not.toMatch(/PAT\/admin|instance admin|rate limiter/i);
    });

    it("stops naming the query guards, now that it composes its own guarded client", () => {
      const named = API_UNAVAILABLE_PRODUCT_ADAPTERS.join("\n");

      expect(named).not.toMatch(/PrismaQueryGuard|multitenancy|mass-delete/i);
    });

    it("stops naming the metric registry, now that it composes and renders its own", () => {
      const named = API_UNAVAILABLE_PRODUCT_ADAPTERS.join("\n");

      expect(named).not.toMatch(/ApiMetricsPort|metric registry/i);
    });

    /** @scenario "The API process composes its own AuthZ service" */
    it("stops naming the grant command pipeline, now that it registers one itself", () => {
      const named = API_UNAVAILABLE_PRODUCT_ADAPTERS.join("\n");

      expect(named).not.toMatch(
        /AuthzGrantsCommandDispatcher|AuthzRevocationTelemetry|grant command pipeline/i,
      );
    });

    /** @scenario "The API process composes its own organization and API-key services" */
    it("stops naming the identity ports, now that it composes the services that take them", () => {
      const named = API_UNAVAILABLE_PRODUCT_ADAPTERS.join("\n");

      expect(named).not.toMatch(
        /ApiKeyBindingIdPort|ApiKeyDiagnosticsPort|organization identity ports/i,
      );
    });

    /** @scenario "The unavailable-adapter list no longer names the agent ports" */
    it("stops naming the agent ports, now that packaged adapters fill them", () => {
      const named = API_UNAVAILABLE_PRODUCT_ADAPTERS.join("\n");

      expect(named).not.toMatch(/AgentsWorkflowPort|AgentsAuditLogPort|agent audit history/i);
    });

    it("stops naming the stored-secret key, now that it reads and uses its own", () => {
      const named = API_UNAVAILABLE_PRODUCT_ADAPTERS.join("\n");

      expect(named).not.toMatch(
        /SecretEncryptionPort|OrganizationSettingsSecretPort|encryption key/i,
      );
    });

    /** @scenario "An injected metrics transport answers every scrape" */
    it("serves a host's metrics transport in preference to the one it would compose", async () => {
      const metrics = new TestMetrics();
      const process = await ApiStandaloneComposition.create({ metrics }).compose({
        config: ephemeralConfig({ METRICS_API_KEY: "a-key-this-process-never-uses" }),
        graph: new TestGraph(),
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });

      const address = await process.start();
      if (!address)
        throw new Error("The standalone API process did not report a listener address.");

      const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("langwatch_api_up 1");

      await process.close();
    });

    /** @scenario "An authenticated scrape renders what this process recorded" */
    it("composes its own metrics transport behind the credential the deployment configured", async () => {
      const process = await ApiStandaloneComposition.create().compose({
        config: ephemeralConfig({ METRICS_API_KEY: "scrape-me" }),
        graph: new TestGraph(),
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });

      const address = await process.start();
      if (!address)
        throw new Error("The standalone API process did not report a listener address.");

      const refused = await fetch(`http://127.0.0.1:${address.port}/metrics`);
      expect(refused.status).toBe(401);
      expect(await refused.text()).toBe("");

      const scraped = await fetch(`http://127.0.0.1:${address.port}/metrics`, {
        headers: { authorization: "Bearer scrape-me" },
      });
      expect(scraped.status).toBe(200);
      expect(await scraped.text()).toContain("process_cpu_user_seconds_total");

      await process.close();
    });

    /** @scenario "In production an unset key leaves the process with no metrics endpoint" */
    it("mounts no metrics route in production without a credential, rather than an open one", async () => {
      const process = await ApiStandaloneComposition.create().compose({
        config: ephemeralConfig({ NODE_ENV: "production" }),
        graph: new TestGraph(),
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });

      const address = await process.start();
      if (!address)
        throw new Error("The standalone API process did not report a listener address.");

      expect(await fetch(`http://127.0.0.1:${address.port}/metrics`)).toHaveProperty("status", 404);
      expect(await fetch(`http://127.0.0.1:${address.port}/api/health`)).toHaveProperty(
        "status",
        204,
      );

      await process.close();
    });

    /** @scenario "Outside production an unset key leaves the endpoint open" */
    it("serves its metrics openly outside production, as the web process always has", async () => {
      const process = await ApiStandaloneComposition.create().compose({
        config: ephemeralConfig(),
        graph: new TestGraph(),
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });

      const address = await process.start();
      if (!address)
        throw new Error("The standalone API process did not report a listener address.");

      const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("process_cpu_user_seconds_total");

      await process.close();
    });

    it("gates the listener behind readiness and reports a failed dependency as a boot failure", async () => {
      const readiness = new FailingReadiness();
      const process = await ApiStandaloneComposition.create({ readiness }).compose({
        config: ephemeralConfig(),
        graph: new TestGraph(),
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });

      await expect(process.start()).rejects.toThrow("Redis is unreachable");

      await process.close();
    });

    it("drains intake, then feature work, then telemetry, then infrastructure", async () => {
      const phases: string[] = [];
      const graph = new RecordingGraph(phases);
      const featureDrain = new RecordingFeatureDrain(phases);
      const process = await ApiStandaloneComposition.create({ featureDrain }).compose({
        config: ephemeralConfig(),
        graph,
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });

      await process.start();
      await process.close();

      expect(phases).toEqual(["feature drain", "graph drain", "graph close"]);
    });
  });

  describe("when a host supplied every product adapter except the secret service", () => {
    it("serves the rest of the process without a secret door, rather than refusing to boot", async () => {
      const { secrets: _injected, ...withoutSecrets } = testProducts();
      const composed = await ApiStandaloneComposition.create({
        products: withoutSecrets,
      }).compose({
        config: ephemeralConfig(),
        graph: new TestGraph(),
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });

      const address = await composed.start();
      if (!address) throw new Error("The API process did not report a listener address.");

      expect(await fetch(`http://127.0.0.1:${address.port}/api/health`)).toHaveProperty(
        "status",
        204,
      );
      const secretDoor = await fetch(`http://127.0.0.1:${address.port}/api/secret`, {
        method: "POST",
      });
      expect(secretDoor.status).toBe(404);

      await composed.close();
    });
  });

  describe("when a host supplied product service adapters", () => {
    it("mounts the product transports the bare process surface does not serve", async () => {
      const bare = await ApiStandaloneComposition.create().compose({
        config: ephemeralConfig(),
        graph: new TestGraph(),
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });
      const bareAddress = await bare.start();
      if (!bareAddress) throw new Error("The bare API process did not report a listener address.");
      const unmounted = await fetch(`http://127.0.0.1:${bareAddress.port}/api/secret`, {
        method: "POST",
      });
      expect(unmounted.status).toBe(404);
      await bare.close();

      const composed = await ApiStandaloneComposition.create({ products: testProducts() }).compose({
        config: ephemeralConfig(),
        graph: new TestGraph(),
        observability: { serviceName: "langwatch-api-test" },
        resources: new ResourceScope(),
      });
      const address = await composed.start();
      if (!address) throw new Error("The product API process did not report a listener address.");

      expect(await fetch(`http://127.0.0.1:${address.port}/api/health`)).toHaveProperty(
        "status",
        204,
      );
      const mounted = await fetch(`http://127.0.0.1:${address.port}/api/secret`, {
        method: "POST",
      });
      expect(mounted.status).not.toBe(404);

      await composed.close();
    });
  });
});

/**
 * The six services a host owns. Only their identity matters here: the test
 * asserts which transports get mounted, not what any of them return.
 */
function testProducts(): NonNullable<ApiStandaloneCompositionOptions["products"]> {
  return {
    agents: new Proxy(AgentService.prototype, {}),
    secrets: new Proxy(SecretService.prototype, {}),
    apiKeys: new Proxy(ApiKeyService.prototype, {}),
    authz: new Proxy(AuthzService.prototype, {}),
    organizations: new Proxy(OrganizationService.prototype, {}),
    auth: new TestAuthComposition(),
  };
}

class TestAuthComposition extends ApiAuthSessionCompositionPort {
  compose() {
    return { auth: new TestAuthService(), sessions: new TestSessionTransport() };
  }
}

class TestAuthService extends AuthService {
  async tryResolveBrowserSession() {
    return null;
  }

  async revokeAllBrowserSessions(): Promise<void> {}
  async revokeBrowserSession(): Promise<void> {}
  async revokeOtherBrowserSessions(): Promise<void> {}
}

class TestSessionTransport extends ApiBrowserSessionTransportPort {
  async tryResolveVerifiedSession() {
    return null;
  }
}

class TestGraph extends ApiProcessGraphPort {
  async close(): Promise<void> {}
}

class RecordingGraph extends ApiProcessGraphPort {
  constructor(private readonly phases: string[]) {
    super();
  }

  async drain(): Promise<void> {
    this.phases.push("graph drain");
  }

  async close(): Promise<void> {
    this.phases.push("graph close");
  }
}

class RecordingFeatureDrain extends ApiFeatureDrainPort {
  constructor(private readonly phases: string[]) {
    super();
  }

  async drain(): Promise<void> {
    this.phases.push("feature drain");
  }
}

class TestMetrics extends ApiMetricsPort {
  async respond(): Promise<Response> {
    return new Response("langwatch_api_up 1", { status: 200 });
  }
}

class FailingReadiness extends ApiReadinessPort {
  assertReady(): Promise<void> {
    return Promise.reject(new Error("Redis is unreachable"));
  }
}
