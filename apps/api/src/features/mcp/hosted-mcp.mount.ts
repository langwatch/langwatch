import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMcpHandler,
  HeaderMcpClientAddressAdapter,
  MCP_AUTHORIZE_PERMISSION,
  McpProjectLookupPort,
  McpSessionGrantPort,
  McpSessionToolRegistrarPort,
  type HostedMcpDependencies,
  type HostedMcpRedis,
  type McpHandler,
  type McpToolServer,
} from "@langwatch/hosted-mcp-server";
import type { AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { ApiRawRequestSurfacePort } from "../../api-http.listener";

/**
 * The hosted Model Context Protocol endpoint, composed for this process.
 *
 * It is a raw surface rather than a REST feature, and that is a property of
 * the protocol rather than a shortcut: the Streamable HTTP and Server-Sent
 * Events transports the MCP SDK owns write to the Node response object and
 * hold it open for the life of a session. It carries its own bearer and OAuth
 * authentication for the same reason — the tokens it accepts are ones it
 * minted, and no other surface issues or reads them.
 */
export class HostedMcpSurface extends ApiRawRequestSurfacePort {
  private constructor(private readonly handler: McpHandler) {
    super();
  }

  static create(dependencies: HostedMcpDependencies): HostedMcpSurface {
    return new HostedMcpSurface(createMcpHandler(dependencies));
  }

  handles(pathname: string): boolean {
    return this.handler.isMcpRoute(pathname);
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    this.handler.handleRequest(request, response);
  }

  /** Releases every live session; the process drains this before it exits. */
  closeAllSessions(): Promise<void> {
    return this.handler.closeAllSessions();
  }
}

/**
 * The project an MCP bearer token belongs to, read through the process's own
 * guarded client.
 *
 * Archived projects are excluded in the query rather than filtered after: a
 * key that still authenticates against an archived project is an
 * authentication decision, and it belongs in the predicate that makes it.
 */
export class PrismaMcpProjectLookupAdapter extends McpProjectLookupPort {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create({ prisma }: { prisma: PrismaClient }): PrismaMcpProjectLookupAdapter {
    return new PrismaMcpProjectLookupAdapter(prisma);
  }

  async findLiveProjectByApiKey({
    apiKey,
  }: {
    apiKey: string;
  }): Promise<{ id: string; teamId: string } | null> {
    return await this.prisma.project.findUnique({
      where: { apiKey, archivedAt: null },
      select: { id: true, teamId: true },
    });
  }
}

/**
 * Whether the person an MCP bearer was minted for still holds the grant the
 * approval step demanded. The SAME permission the authorize step names, read
 * through the SAME `AuthzService` every other door decides on — a second
 * answer here would be a token that outlived the membership behind it.
 */
export class AuthzMcpSessionGrantAdapter extends McpSessionGrantPort {
  private constructor(private readonly authz: AuthzService) {
    super();
  }

  static create({ authz }: { authz: AuthzService }): AuthzMcpSessionGrantAdapter {
    return new AuthzMcpSessionGrantAdapter(authz);
  }

  async stillGranted({
    userId,
    projectId,
  }: {
    userId: string;
    projectId: string;
  }): Promise<boolean> {
    return await this.authz.hasPermission({
      userId,
      projectId,
      permission: MCP_AUTHORIZE_PERMISSION,
    });
  }
}

/**
 * Installs the tools an Enterprise deployment adds to each MCP session.
 *
 * The registrar is a function rather than the governance module itself
 * because this file may not name an Enterprise package's internals: what the
 * composition root holds is `registerGovernanceMcpTools` from
 * `@langwatch/enterprise-governance-server`, already bound to its service and
 * its permission probe, and what the endpoint holds is this port.
 */
export class DelegatingMcpSessionToolRegistrar extends McpSessionToolRegistrarPort {
  private constructor(
    private readonly install: (input: {
      server: McpToolServer;
      apiKey: string;
      callerUserId: string | undefined;
    }) => void,
  ) {
    super();
  }

  static create(
    install: (input: {
      server: McpToolServer;
      apiKey: string;
      callerUserId: string | undefined;
    }) => void,
  ): DelegatingMcpSessionToolRegistrar {
    return new DelegatingMcpSessionToolRegistrar(install);
  }

  register(input: {
    server: McpToolServer;
    apiKey: string;
    callerUserId: string | undefined;
  }): void {
    this.install(input);
  }
}

/**
 * Composes the endpoint, or reports that this process cannot serve it.
 *
 * Three things are required and none has a safe default. Without the cipher
 * the endpoint cannot store the API key an OAuth session was minted from, so
 * every session it issued would fail on its first tool call; without a
 * database it cannot tell whose key a bearer token is; without authorization
 * it cannot re-prove the grant a thirty-day bearer was minted from. A
 * deployment missing any serves no MCP rather than a broken one, and says so.
 */
export function tryCreateHostedMcpSurface(options: {
  prisma: PrismaClient | undefined;
  encryption: SecretEncryptionPort | undefined;
  authz: AuthzService | undefined;
  redis: HostedMcpRedis | null;
  baseHost: string;
  sessionTools?: McpSessionToolRegistrarPort | undefined;
}): HostedMcpSurface | undefined {
  const { prisma, encryption, authz } = options;
  if (!prisma || !encryption || !authz) return undefined;

  return HostedMcpSurface.create({
    redis: options.redis,
    projects: PrismaMcpProjectLookupAdapter.create({ prisma }),
    grants: AuthzMcpSessionGrantAdapter.create({ authz }),
    cipher: encryption,
    address: HeaderMcpClientAddressAdapter.create(),
    sessionTools: options.sessionTools,
    baseHost: options.baseHost,
  });
}
