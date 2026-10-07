/**
 * @vitest-environment node
 *
 * Regression guard: no shipped compose file may publish a datastore or an
 * internal service on every host interface.
 *
 * `infra/compose.yml` used to publish Postgres (5432), ClickHouse (8123) and
 * langevals (5562) as bare `"5432:5432"` mappings, which Docker binds on
 * 0.0.0.0. Docker inserts its own iptables rules ahead of host firewalls like
 * ufw and firewalld, so an operator's "deny all" rule did not cover them: on any
 * host with a public IP, the repo's default credentials opened the database and
 * every captured trace to the internet. The app and workers reach these
 * services over the compose network, so the self-host file publishes nothing
 * but the app. Dev and test overlays that do need host access bind loopback.
 *
 * These are file-content assertions against the real compose files on disk:
 * what a port mapping binds is a fact about its text.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

// src/__tests__/ -> ../../ = platform/app/ -> ../../ = repo root
const REPO_ROOT = path.join(__dirname, "../../../..");

const SELF_HOST_COMPOSE = "infra/compose.yml";

/** Every compose file the repo runs, by hand, from make, or from CI. */
const ALL_COMPOSE_FILES = [
  SELF_HOST_COMPOSE,
  "dev/compose.dev.yml",
  "dev/compose.dev.migration.yml",
  "tests/agentic-e2e/compose.yml",
];

/** Services that hold data or serve unauthenticated internal APIs. */
const INTERNAL_SERVICES = new Set([
  "postgres",
  "clickhouse",
  "redis",
  "langevals",
  "langwatch_nlp",
  "opensearch",
]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

type PortEntry = string | number | { host_ip?: string; published?: unknown };

interface ComposeFile {
  services: Record<
    string,
    { ports?: PortEntry[]; environment?: Record<string, unknown> | string[] }
  >;
}

function readCompose(relativePath: string): ComposeFile {
  return load(
    readFileSync(path.join(REPO_ROOT, relativePath), "utf-8"),
  ) as ComposeFile;
}

/**
 * The host interface a port mapping binds, or null when it binds all of them.
 * Short syntax is `[HOST:]PUBLISHED:TARGET`; a mapping with no host address is
 * the 0.0.0.0 case. Variable defaults (`${X:-5432}`) contain colons, so they
 * are collapsed before splitting.
 */
function hostIpOf(entry: PortEntry): string | null {
  if (typeof entry === "object") return entry.host_ip ?? null;
  const collapsed = String(entry).replace(/\$\{[^}]*\}/g, "VAR");
  const ipv6 = collapsed.match(/^(\[[^\]]+\]):/);
  if (ipv6) return ipv6[1]!;
  const parts = collapsed.split(":");
  return parts.length === 3 ? parts[0]! : null;
}

describe("compose port exposure", () => {
  describe("given the self-host compose file", () => {
    const compose = readCompose(SELF_HOST_COMPOSE);

    it("publishes host ports for the app only", () => {
      const publishing = Object.entries(compose.services)
        .filter(([, service]) => (service.ports ?? []).length > 0)
        .map(([name]) => name);

      expect(publishing).toEqual(["app"]);
    });

    it("reads the Postgres and ClickHouse passwords from the environment", () => {
      const postgresEnv = compose.services.postgres?.environment as Record<
        string,
        unknown
      >;
      const clickhouseEnv = compose.services.clickhouse?.environment as Record<
        string,
        unknown
      >;

      expect(String(postgresEnv.POSTGRES_PASSWORD)).toMatch(
        /^\$\{POSTGRES_PASSWORD[:}]/,
      );
      expect(String(clickhouseEnv.CLICKHOUSE_PASSWORD)).toMatch(
        /^\$\{CLICKHOUSE_PASSWORD[:}]/,
      );
    });
  });

  describe.each(ALL_COMPOSE_FILES)("given %s", (file) => {
    it("binds every internal service port to loopback", () => {
      const compose = readCompose(file);
      const exposed = Object.entries(compose.services)
        .filter(([name]) => INTERNAL_SERVICES.has(name))
        .flatMap(([name, service]) =>
          (service.ports ?? [])
            .filter((entry) => {
              const host = hostIpOf(entry);
              return host === null || !LOOPBACK_HOSTS.has(host);
            })
            .map((entry) => `${name}: ${JSON.stringify(entry)}`),
        );

      expect(exposed).toEqual([]);
    });
  });
});
