import { createServer } from "node:http";
import { AgentService } from "@langwatch/agent-contract";
import { ApiKeyService } from "@langwatch/api-key-contract";
import { AuthService } from "@langwatch/auth-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { configureLogger, createLogger } from "@langwatch/observability";
import { OrganizationService } from "@langwatch/organization-contract";
import { SecretService } from "@langwatch/secret-contract";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
} from "../app/api-auth.composition";
import { API_UNAVAILABLE_PRODUCT_ADAPTERS } from "../app/api-standalone.composition";
import {
  startStandaloneApi,
  type ApiExecutableHost,
  type ApiExecutableHostEvent,
  type ApiStandaloneExecutableOptions,
} from "../app/api-standalone.executable";
import { apiLoggerConfiguration, resolveApiConfig } from "../platform/config/api.config";

/**
 * The executable's boot proof.
 *
 * It drives the REAL entry path — `startStandaloneApi` over an injected host —
 * rather than a composition constructed by hand, because the two things this
 * file exists to pin are properties of the wiring between them: which
 * composition the entry reaches for, and what happens before a socket opens.
 *
 * No datastore is required and none is used. The process composes a Prisma
 * client from a connection string without dialling it (Prisma connects on its
 * first query), so a boot with `DATABASE_URL` set is exactly the shape a
 * deployment has and exactly as deterministic as one without.
 */
describe("the standalone API executable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the deployment supplies no product service adapters", () => {
    /** @scenario "The start command boots the production composition" */
    it("composes the production graph rather than a second, smaller one", async () => {
      const environment = deployment({ DATABASE_URL: "postgresql://localhost:5432/langwatch" });
      const log = spyOnBootLog(environment);

      const started = await startStandaloneApi({ host: new RecordingHost(environment) });

      // Both lines come from collaborators only the production composition
      // resolves. The process surface this executable used to boot composed a
      // database and a queue and stopped, so neither could ever be reported.
      expect(logged(log.info)).toContainEqual(
        expect.stringContaining("API composed without a Group Queue"),
      );
      expect(logged(log.warn)).toContainEqual(
        expect.stringContaining("API composed no AuthZ service and no host supplied one"),
      );

      await started.close();
    });

    /** @scenario "The started process answers its health route" */
    it("serves its own health route from a real listener", async () => {
      const environment = deployment();
      const started = await startStandaloneApi({ host: new RecordingHost(environment) });

      const health = await fetch(`http://127.0.0.1:${environment.API_PORT}/api/health`);
      expect(health.status).toBe(204);
      expect(await health.text()).toBe("");

      await started.close();
      await expect(fetch(`http://127.0.0.1:${environment.API_PORT}/api/health`)).rejects.toThrow();
    });

    /** @scenario "The boot names the transport the deployment did not supply" */
    it("announces the one adapter no package implements, and serves anyway", async () => {
      const environment = deployment();
      const log = spyOnBootLog(environment);

      const started = await startStandaloneApi({ host: new RecordingHost(environment) });

      expect(log.warn).toHaveBeenCalledWith(
        { adapters: API_UNAVAILABLE_PRODUCT_ADAPTERS },
        expect.stringContaining("without an adapter no package implements"),
      );
      expect(await fetch(`http://127.0.0.1:${environment.API_PORT}/api/health`)).toHaveProperty(
        "status",
        204,
      );

      await started.close();
    });

    /** @scenario "Each absent collaborator is named on its own line" */
    it("names the absent database, queue and dispatch separately", async () => {
      const environment = deployment();
      const log = spyOnBootLog(environment);

      const started = await startStandaloneApi({ host: new RecordingHost(environment) });

      expect(logged(log.info)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("API composed without Postgres"),
          expect.stringContaining("API composed without Redis"),
          expect.stringContaining("API composed without a Group Queue"),
        ]),
      );

      await started.close();
    });

    /** @scenario "The signal handlers the executable installed are removed when it closes" */
    it("removes the shutdown signal handlers from the host it installed them on", async () => {
      const environment = deployment();
      const host = new RecordingHost(environment);

      const started = await startStandaloneApi({ host });
      expect(host.subscribers("SIGTERM")).toBe(1);
      expect(host.subscribers("SIGINT")).toBe(1);

      await started.close();

      expect(host.subscribers("SIGTERM")).toBe(0);
      expect(host.subscribers("SIGINT")).toBe(0);
    });
  });

  describe("when a host supplies its own product services", () => {
    /** @scenario "A host's product services override what the process would compose" */
    it("serves the transports those services carry", async () => {
      const environment = deployment();

      const started = await startStandaloneApi({
        host: new RecordingHost(environment),
        products: hostProducts(),
      });

      const secretDoor = await fetch(`http://127.0.0.1:${environment.API_PORT}/api/secret`, {
        method: "POST",
      });
      expect(secretDoor.status).not.toBe(404);

      await started.close();
    });
  });

  describe("when the environment carries an invalid configuration value", () => {
    /** @scenario "A misconfigured value refuses the boot and names the leaf" */
    it("refuses the boot and names the configuration leaf that was wrong", async () => {
      const host = new RecordingHost(deployment({ NODE_ENV: "banana" }));

      await expect(startStandaloneApi({ host })).rejects.toThrow(/nodeEnvironment/);
    });

    /** @scenario "A refused boot leaves the configured port free" */
    it("opens no socket on the port the deployment configured", async () => {
      const environment = deployment({ NODE_ENV: "banana" });
      const host = new RecordingHost(environment);

      await expect(startStandaloneApi({ host })).rejects.toThrow();

      await expect(fetch(`http://127.0.0.1:${environment.API_PORT}/api/health`)).rejects.toThrow();
      // Bindable is the stronger claim: a refused connection could also mean a
      // listener that opened and closed, and a port still held would fail here.
      await expect(bind(Number(environment.API_PORT))).resolves.toBeUndefined();
    });

    /** @scenario "A failed boot is reported on the process's error stream" */
    it("writes the failure where the operator reads it, message first", async () => {
      const host = new RecordingHost(deployment({ NODE_ENV: "banana" }));

      await expect(startStandaloneApi({ host })).rejects.toThrow();

      expect(host.written).toHaveLength(1);
      const [report = ""] = host.written;
      expect(report).toMatch(/^\[langwatch:api\] fatal boot failure: Invalid api configuration/);
      expect(report.split("\n")[0]).toContain("nodeEnvironment");
    });
  });
});

/**
 * One deployment's environment, with a port reserved for it.
 *
 * The port is claimed and released before the process starts, so a test that
 * asserts NOTHING is listening on it is asserting about a port this test owns
 * rather than about whatever else the machine happens to be running.
 */
function deployment(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_SERVICE_NAME: "langwatch-api-executable-test",
    API_PORT: String(reservePort()),
    ...overrides,
  };
}

let nextReservedPort = 0;

/**
 * A port nothing on this machine is using.
 *
 * Reserved by binding and releasing one, then handed out in sequence: the
 * boot proof needs the port BEFORE the process starts, so `API_PORT=0` — which
 * would be the obvious choice — cannot be used here.
 */
function reservePort(): number {
  if (nextReservedPort === 0) {
    nextReservedPort = reservedPortBase;
  }
  return nextReservedPort++;
}

const reservedPortBase = await (async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
})();

/** Resolves when the port is bindable, so a leaked listener fails the test. */
async function bind(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * Watches the boot log this environment will write to.
 *
 * The logger is configured here first, with the SAME configuration the boot
 * resolves, so the boot's own `configureLogger` is the no-op it is designed to
 * be for repeated configuration and the spy survives it. Configuring second
 * would replace the factory and leave the spy on a logger nothing writes to.
 */
function spyOnBootLog(environment: Readonly<Record<string, string>>): {
  info: MockInstance;
  warn: MockInstance;
} {
  configureLogger(apiLoggerConfiguration(resolveApiConfig(environment)));
  const logger = createLogger(String(environment.API_SERVICE_NAME));
  return { info: vi.spyOn(logger, "info"), warn: vi.spyOn(logger, "warn") };
}

/** The message of every call, which is where each absence is named. */
function logged(spy: MockInstance): string[] {
  return spy.mock.calls.map((call) => String(call[1] ?? call[0]));
}

/**
 * The services a host owns. Only their identity matters here: this file
 * asserts which transports a supplied graph mounts, not what any of them
 * answers.
 */
function hostProducts(): NonNullable<ApiStandaloneExecutableOptions["products"]> {
  return {
    agents: new Proxy(AgentService.prototype, {}),
    secrets: new Proxy(SecretService.prototype, {}),
    apiKeys: new Proxy(ApiKeyService.prototype, {}),
    authz: new Proxy(AuthzService.prototype, {}),
    organizations: new Proxy(OrganizationService.prototype, {}),
    auth: new HostAuthComposition(),
  };
}

class HostAuthComposition extends ApiAuthSessionCompositionPort {
  compose() {
    return { auth: new HostAuthService(), sessions: new HostSessionTransport() };
  }
}

class HostAuthService extends AuthService {
  async tryResolveBrowserSession() {
    return null;
  }

  async revokeAllBrowserSessions(): Promise<void> {}
  async revokeBrowserSession(): Promise<void> {}
  async revokeOtherBrowserSessions(): Promise<void> {}
}

class HostSessionTransport extends ApiBrowserSessionTransportPort {
  async tryResolveVerifiedSession() {
    return null;
  }
}

/**
 * The process the executable runs in, recorded rather than real.
 *
 * Every coupling the executable has to a process goes through this one object,
 * which is what lets a boot proof run without registering a signal handler or
 * an exit hook on the test runner.
 */
class RecordingHost implements ApiExecutableHost {
  readonly written: string[] = [];
  readonly exits: number[] = [];
  private readonly listeners = new Map<ApiExecutableHostEvent, Set<(value: unknown) => void>>();

  constructor(readonly env: Readonly<Record<string, unknown>>) {}

  on(event: ApiExecutableHostEvent, listener: (value: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set<(value: unknown) => void>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: ApiExecutableHostEvent, listener: (value: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  exit(code: number): void {
    this.exits.push(code);
  }

  write(line: string): void {
    this.written.push(line);
  }

  subscribers(event: ApiExecutableHostEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
