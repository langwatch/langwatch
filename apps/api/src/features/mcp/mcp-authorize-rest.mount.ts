/**
 * Binds the hosted MCP approval step to this process's own graph. No API
 * credential opens the door — the consent page arrives on a browser session,
 * which the route reads as a declared fact and answers its own 401 for.
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  McpAuthorizationService,
  mcpAuthorizeApprover,
  mcpAuthorizeRest,
  MCP_AUTHORIZE_PERMISSION,
  type HostedMcpRedis,
  type McpApprover,
  type McpAuthorizeApi,
  type McpAuthorizeProject,
} from "@langwatch/hosted-mcp-server";

/** What the approval step reaches that this process's graph owns. */
export interface McpAuthorizeRestPorts {
  /** The signed-in person behind this request, or null for an anonymous one. */
  resolveSession(request: Request): Promise<McpApprover | null>;
  /** The project, with the credential the code embeds. Null when unreadable. */
  findProject(projectId: string): Promise<McpAuthorizeProject | null>;
  /**
   * Whether that person holds the named permission on that project. The
   * permission is named by the module rather than by the process, so no
   * composition can gate the flow below what the minted code confers.
   */
  probeProjectPermission(input: {
    session: McpApprover;
    projectId: string;
    permission: typeof MCP_AUTHORIZE_PERMISSION;
  }): Promise<boolean>;
  /** Whether the project is the globally-readable demo showcase. */
  isDemoProject(projectId: string): boolean;
  /** The at-rest cipher the embedded credential is written under. */
  encrypt(value: string): string;
  /** Where the code lives for its ten minutes. Null means no code can be minted. */
  redis: HostedMcpRedis | null;
}

/** `POST /api/mcp/authorize`, bound to one process's session and cipher. */
export function mountMcpAuthorizeRest(ports: McpAuthorizeRestPorts): MountableRestApp {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The MCP approval step answers with no credential resolved.");
      },
    },
  });

  return runtime.mount(mcpAuthorizeRest.router(), {
    app: () => mcpAuthorizeApp(ports),
    credential: "public",
    onError: mcpAuthorizeErrors,
    facts: [
      bindRestMiddleware(mcpAuthorizeApprover, (context) => ports.resolveSession(context.req.raw)),
    ],
  });
}

/** The approval itself, over the collaborators this process composed for it. */
function mcpAuthorizeApp(ports: McpAuthorizeRestPorts): McpAuthorizeApi {
  const authorization = McpAuthorizationService.create({
    collaborators: {
      findProject: ({ projectId }) => ports.findProject(projectId),
      mayApprove: ({ approver, projectId, permission }) =>
        ports.probeProjectPermission({ session: approver, projectId, permission }),
      isDemoProject: ({ projectId }) => ports.isDemoProject(projectId),
      encrypt: (value) => ports.encrypt(value),
      redis: ports.redis,
    },
  });

  return { approve: (request) => authorization.approve(request) };
}

/**
 * Every refusal this route can word is a declared ANSWER, so nothing reaches
 * here but a failure nobody anticipated — and one of those tells the waiting
 * client nothing beyond the fact that the approval did not complete.
 */
const mcpAuthorizeErrors: RestErrorHandler = (_error, context) =>
  context.json({ error: "Internal server error" }, 500);
