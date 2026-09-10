import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMcpHandler,
  HeaderMcpClientAddressAdapter,
  MCP_AUTHORIZE_PERMISSION,
  McpProjectLookup,
  McpSessionGrant,
  McpSessionToolRegistrar,
  type HostedMcpDependencies,
  type HostedMcpRedis,
  type McpHandler,
  type McpToolServer,
} from "@langwatch/hosted-mcp-server";
import type { AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretEncryption } from "@langwatch/secret-server";
import { ApiRawRequestSurface } from "../../api-http.listener.ts";

/**
 * The hosted Model Context Protocol endpoint, composed for this process.
 */
export class HostedMcpSurface extends ApiRawRequestSurface {
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
 * The project an MCP bearer token belongs to, read through the process's own guarded
 * client.
 */
export class PrismaMcpProjectLookupAdapter extends McpProjectLookup {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create({ prisma }: { prisma: PrismaClient }): PrismaMcpProjectLookupAdapter {
    return new PrismaMcpProjectLookupAdapter(prisma);
  }

  async tryFindLiveProjectByApiKey({
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
 * Whether the person an MCP bearer was minted for still holds the grant the approval step
 * demanded.
 */
export class AuthzMcpSessionGrantAdapter extends McpSessionGrant {
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
 */
export class DelegatingMcpSessionToolRegistrar extends McpSessionToolRegistrar {
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
 * Composes the endpoint, or reports that this process cannot serve it. Three things are
 * required and none has a safe default.
 */
export function tryCreateHostedMcpSurface(options: {
  prisma: PrismaClient | undefined;
  encryption: SecretEncryption | undefined;
  authz: AuthzService | undefined;
  redis: HostedMcpRedis | null;
  baseHost: string;
  sessionTools?: McpSessionToolRegistrar | undefined;
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
