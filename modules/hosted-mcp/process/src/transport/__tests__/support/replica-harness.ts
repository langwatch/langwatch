/**
 * Two hosted MCP replicas sharing one Redis, for the cross-replica suites, kept
 * apart from the scenarios so those read as behaviour rather than as plumbing.
 */
import { createServer, type Server, type IncomingMessage } from "node:http";

import { type Cluster, Redis } from "ioredis";

import { HostedMcpModule } from "../../../app/hosted-mcp.app.ts";
import { LiveHostedMcpRepositories } from "../../../repositories/live/live.hosted-mcp.repositories.ts";
import type { McpSessionCipher } from "../../../repositories/mcp-session.repository.ts";
import { RedisMcpSessionRepository } from "../../../repositories/redis/redis.mcp-session.repository.ts";
import type { AuthzMcpSessionGrantService } from "../../../services/authz-mcp-session-grant.service.ts";
import type { HeaderMcpClientAddressService } from "../../../services/header-mcp-client-address.service.ts";
import type { McpHandler } from "../../../services/mcp-endpoint.service.ts";
import type {
  McpLiveProjectLookup,
  ProjectMcpProjectLookupService,
} from "../../../services/project-mcp-project-lookup.service.ts";
import { FakeCliSessions } from "./fake-cli-sessions.ts";

export const SESSION_PREFIX = "mcp:session:";

/**
 * The Redis these suites talk to. Opened by the suite, so the suite closes it.
 * Native Redis is the local default; CI hands the URL in.
 */
export function connectTestRedis(): Redis | Cluster {
  const url =
    process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url, { maxRetriesPerRequest: null });
}

/** The project every key in `apiKeys` belongs to, keyed by the key itself. */
class HarnessProjectLookup implements Pick<
  ProjectMcpProjectLookupService,
  "resolveLiveProjectByApiKey"
> {
  constructor(private readonly apiKeys: readonly string[]) {}
  resolveLiveProjectByApiKey({ apiKey }: { apiKey: string }): Promise<McpLiveProjectLookup> {
    return Promise.resolve(
      this.apiKeys.includes(apiKey)
        ? { kind: "live", project: { id: `project-for-${apiKey}`, teamId: "team-1" } }
        : { kind: "unknown" },
    );
  }
}

/** Every grant holds: these suites are about transport, not about revocation. */
class HarnessSessionGrant implements Pick<AuthzMcpSessionGrantService, "stillGranted"> {
  stillGranted(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** Identity "encryption", so a suite can read the value it expected to be stored. */
class HarnessCipher implements McpSessionCipher {
  encrypt(text: string): string {
    return `encrypted:${text}`;
  }
  decrypt(text: string): string {
    return text.startsWith("encrypted:") ? text.slice(10) : text;
  }
}

/** Every replica answers on loopback, so every caller is the same address. */
class HarnessClientAddress implements Pick<HeaderMcpClientAddressService, "clientIp"> {
  clientIp(request: IncomingMessage): string {
    return request.socket.remoteAddress ?? "127.0.0.1";
  }
}

/**
 * Ends every session a key recorded, through the repository so the key layout stays production's.
 * Records outlive the process that wrote them, so a suite that leaves them behind spends the
 * project's concurrent-session budget on its own debris.
 */
export async function clearRecordedSessions({
  redis,
  apiKey,
}: {
  redis: Redis | Cluster;
  apiKey: string;
}): Promise<void> {
  const records = RedisMcpSessionRepository.create({ redis, cipher: new HarnessCipher() });
  for (const recordKey of await redis.keys(`${SESSION_PREFIX}*`)) {
    const sessionId = recordKey.slice(SESSION_PREFIX.length);
    const record = await records.getRecord({ sessionId }).catch(() => undefined);
    if (record?.kind === "found" && record.apiKey === apiKey) {
      await records.remove({ sessionId, apiKey });
    }
  }
}

export interface ReplicaPair {
  urlA: string;
  urlB: string;
  /** Whether replica B holds a live copy of the session. */
  bHolds: (sessionId: string) => boolean;
  stop: () => Promise<void>;
}

/**
 * Two handlers, each on its own server, sharing one Redis — the shape of
 * production: replicas behind a load balancer with no session affinity, each
 * with its own session map, only Redis in common.
 */
export async function startReplicaPair({
  redis,
  apiKeys,
}: {
  redis: Redis | Cluster;
  apiKeys: string[];
}): Promise<ReplicaPair> {
  for (const apiKey of apiKeys) {
    await clearRecordedSessions({ redis, apiKey });
  }

  const handlers: McpHandler[] = [];
  const servers: Server[] = [];
  const urls: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const handler = HostedMcpModule.fromDependencies({
        repositories: LiveHostedMcpRepositories.create({ redis, encryption: new HarnessCipher() }),
        projects: new HarnessProjectLookup(apiKeys),
        grants: new HarnessSessionGrant(),
        cliSessions: new FakeCliSessions(),
        address: new HarnessClientAddress(),
        baseHost: "https://app.langwatch.ai",
      }).createHandler();
      const server = createServer((req, res) => handler.handleRequest(req, res));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (typeof address !== "object" || !address) {
        throw new Error("a replica reported no address after listening");
      }
      handlers.push(handler);
      servers.push(server);
      urls.push(`http://127.0.0.1:${address.port}`);
    }
  } catch (err) {
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    throw err;
  }

  return {
    urlA: urls[0]!,
    urlB: urls[1]!,
    bHolds: (sessionId) => handlers[1]!.holdsSession(sessionId),
    async stop() {
      for (const handler of handlers) await handler.closeAllSessions();
      for (const server of servers) {
        const closing = new Promise<void>((resolve) => server.close(() => resolve()));
        // An open GET stream is an active request, which close() alone would wait out.
        server.closeAllConnections();
        await closing;
      }
      for (const apiKey of apiKeys) {
        await clearRecordedSessions({ redis, apiKey });
      }
    },
  };
}

export function initializeBody(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "replica-test-client", version: "1.0.0" },
    },
  };
}
