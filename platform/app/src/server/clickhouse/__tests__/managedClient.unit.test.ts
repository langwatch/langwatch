import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const driver = vi.hoisted(() => ({
  createClient: vi.fn(),
  lastOptions: null as Record<string, unknown> | null,
}));

vi.mock("@clickhouse/client", () => ({
  createClient: (options: Record<string, unknown>) => {
    driver.lastOptions = options;
    driver.createClient(options);
    return {
      query: vi.fn().mockResolvedValue({ json: async () => [] }),
      insert: vi.fn().mockResolvedValue({}),
      command: vi.fn().mockResolvedValue({}),
      exec: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    };
  },
}));

const registered = vi.hoisted(() => ({ instances: [] as string[] }));

vi.mock("~/server/clickhouse/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/clickhouse/metrics")>();
  return {
    ...actual,
    registerClickHouseLimiter: (instance: string, probe: unknown) => {
      registered.instances.push(instance);
      return actual.registerClickHouseLimiter(
        instance,
        probe as () => { inFlight: number; queued: number },
      );
    },
  };
});

const { createManagedClickHouseClient } = await import("../managedClient");

describe("createManagedClickHouseClient", () => {
  beforeEach(() => {
    registered.instances.length = 0;
    driver.createClient.mockClear();
    driver.lastOptions = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("given the shared instance and a private one", () => {
    describe("when a client is built for each", () => {
      /**
       * The point of a single construction site: the two differ only in their
       * URL. Before this, the private-instance client was assembled by hand at
       * its own call site and silently opted out of the pool size and every
       * bound the shared one had.
       */
      /** @scenario every client is built the same way */
      it("gives both the same bound, and reports both under their own label", () => {
        createManagedClickHouseClient({
          url: "http://localhost:8123/langwatch",
          instance: "shared",
        });
        const sharedPool = driver.lastOptions?.max_open_connections;

        createManagedClickHouseClient({
          url: "http://private:8123/langwatch",
          instance: "org_private",
        });
        const privatePool = driver.lastOptions?.max_open_connections;

        expect(sharedPool).toBe(privatePool);
        expect(sharedPool).toBeTypeOf("number");
        expect(registered.instances).toEqual(["shared", "org_private"]);
      });

      it("keeps every client on the driver settings the shared one has", () => {
        createManagedClickHouseClient({ url: "http://a:8123", instance: "a" });
        const first = driver.lastOptions;
        createManagedClickHouseClient({ url: "http://b:8123", instance: "b" });
        const second = driver.lastOptions;

        for (const key of ["clickhouse_settings", "keep_alive", "max_open_connections"]) {
          // Presence first: comparing the two alone also passes when the
          // setting is absent from both, which is the regression worth having.
          expect(first?.[key], `every managed client sets ${key}`).toBeDefined();
          expect(second?.[key]).toEqual(first?.[key]);
        }
      });
    });
  });

  describe("given a URL that will not parse", () => {
    describe("when a client is built", () => {
      it("passes the raw string through rather than refusing to start", () => {
        expect(() =>
          createManagedClickHouseClient({
            url: "not a url",
            instance: "odd",
          }),
        ).not.toThrow();
        expect(driver.lastOptions?.url).toBe("not a url");
      });
    });
  });
});
