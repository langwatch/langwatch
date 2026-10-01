/**
 * The hosted MCP approval decision: what happens once the consent page has
 * posted a well-formed request, from the registered-client check through to
 * the authorization code that lives in Redis for ten minutes.
 */
import { randomBytes } from "node:crypto";

import { nowInstant, type TimeInput } from "@langwatch/time";

import type { McpOAuthClientRepository } from "../repositories/mcp-oauth-client.repository.ts";
import type { McpOAuthTokenRepository } from "../repositories/mcp-oauth-token.repository.ts";
import {
  buildAuthorizeAnswer,
  classifyPostedFields,
  parsePostedApproval,
  type McpApprovalOutcome,
  type McpAuthorizeAnswer,
} from "../rules/mcp-authorize.rules.ts";

export type { McpApprovalOutcome, McpAuthorizeAnswer } from "../rules/mcp-authorize.rules.ts";
const AUTH_CODE_TTL_SECONDS = 600;

/** 256 bits, the length every other one-time OAuth credential here is minted at. */
const AUTH_CODE_BYTES = 32;

/**
 * The permission a caller must hold to mint an authorization code here. The code embeds the
 * project's legacy API key, which every REST family lets past its RBAC check, so approving one
 * confers the whole project.
 */
export const MCP_AUTHORIZE_PERMISSION = "project:update" as const;

/** The signed-in person an authorization code is minted for. */
export type McpApprover = Readonly<{ user: Readonly<{ id: string }> }>;

/** The project an authorization code is minted against. */
export type McpAuthorizeProject = Readonly<{
  id: string;
  apiKey: string;
  /** When the project was archived, in whatever shape the host holds one. */
  archivedAt: TimeInput | null;
}>;

/** One approval, as the consent page posted it. */
export type McpApprovalRequest = Readonly<{
  approver: McpApprover;
  projectId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string | undefined;
  codeChallengeMethod: string | undefined;
}>;

/** What the approval reaches that this module does not own. */
export interface McpAuthorizationCollaborators {
  /** The project, with the credential the code embeds. Null when unreadable. */
  findProject(input: { projectId: string }): Promise<McpAuthorizeProject | null>;
  /**
   * Whether the approving person holds the permission on the project. It
   * travels with the question, named by this module rather than by the process,
   * so no composition can gate the flow below what the minted code confers.
   */
  mayApprove(input: {
    approver: McpApprover;
    projectId: string;
    permission: typeof MCP_AUTHORIZE_PERMISSION;
  }): Promise<boolean>;
  /** Whether the project is the globally-readable demo showcase. */
  isDemoProject(input: { projectId: string }): boolean;
  /** The at-rest cipher the embedded credential is written under. */
  encrypt(value: string): string;
  /** The registrations a client_id and its redirect URIs are checked against. */
  clients: McpOAuthClientRepository;
  /** Where the code lives for its ten minutes. Unavailable means no code can be minted. */
  codes: McpOAuthTokenRepository;
}

export class McpAuthorizationService {
  readonly #collaborators: McpAuthorizationCollaborators;

  private constructor(collaborators: McpAuthorizationCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(options: {
    collaborators: McpAuthorizationCollaborators;
  }): McpAuthorizationService {
    return new McpAuthorizationService(options.collaborators);
  }

  /**
   * The consent page's post, whole: who is signed in, the fields they approved, and the answer
   * the browser follows next. A blank or absent field is a refusal this route words itself.
   */
  async authorize({
    approverId,
    raw,
  }: {
    approverId: string | undefined;
    raw: string;
  }): Promise<McpAuthorizeAnswer> {
    if (approverId === undefined) return { status: 401, body: { error: "Not authenticated" } };

    const fields = parsePostedApproval(raw);
    if (!fields) return { status: 400, body: { error: "Invalid body" } };

    const checked = classifyPostedFields(fields);
    if (checked.kind === "refused") return { status: 400, body: { error: checked.error } };
    const { projectId, clientId, redirectUri } = checked;

    const outcome = await this.approve({
      approver: { user: { id: approverId } },
      projectId,
      clientId,
      redirectUri,
      codeChallenge: fields.code_challenge,
      codeChallengeMethod: fields.code_challenge_method,
    });
    return buildAuthorizeAnswer({ outcome, redirectUri, state: fields.state });
  }

  /**
   * RFC 6749 §10.6 first: a code is only ever issued to a redirect_uri registered
   * for this client_id. Whoever crafts the authorization request can be an attacker
   * rather than the approving user, and would otherwise be handed the code.
   */
  async approve(request: McpApprovalRequest): Promise<McpApprovalOutcome> {
    const registered = await this.#collaborators.clients.getByClientId({
      clientId: request.clientId,
    });

    if (registered.kind === "unregistered") return { kind: "unregistered-client" };
    if (!registered.client.redirectUris.includes(request.redirectUri)) {
      return { kind: "unregistered-redirect" };
    }

    return this.#approveVerifiedClient(request);
  }

  /**
   * Past this point the client is registered and the redirect URI is one of its own, so a
   * refusal can be carried back to the client rather than left on our own page.
   */
  async #approveVerifiedClient(request: McpApprovalRequest): Promise<McpApprovalOutcome> {
    const { codeChallenge } = request;
    if (!codeChallenge) return { kind: "challenge-missing" };

    // S256 is the only method the discovery document advertises, and the token
    // endpoint verifies every code as S256 regardless of what was requested.
    // Accepting another method here would mint a code that can never be
    // redeemed, so the client learns now rather than at the exchange.
    if (request.codeChallengeMethod && request.codeChallengeMethod !== "S256") {
      return { kind: "challenge-method-unsupported" };
    }

    const project = await this.#reachableProject(request);

    if (!project) return { kind: "denied" };

    if (!this.#collaborators.codes.isAvailable()) return { kind: "unavailable" };

    return { kind: "approved", code: await this.#mint({ request, codeChallenge, project }) };
  }

  /**
   * The project this approval may act on, or nothing — one answer whether the project is
   * missing, archived, the demo showcase, or simply inaccessible, so the refusal never
   * discloses the existence of a project the caller cannot reach.
   */
  async #reachableProject(request: McpApprovalRequest): Promise<McpAuthorizeProject | null> {
    const { projectId } = request;

    // The demo project grants `project:view` to everybody, so the permission
    // probe below would pass for it: it is refused before the probe runs.
    if (this.#collaborators.isDemoProject({ projectId })) return null;

    const project = await this.#collaborators.findProject({ projectId });

    if (!project || project.archivedAt !== null) return null;

    const permitted = await this.#collaborators.mayApprove({
      approver: request.approver,
      projectId,
      permission: MCP_AUTHORIZE_PERMISSION,
    });

    return permitted ? project : null;
  }

  /** The code, and the entry the token exchange redeems it against. */
  async #mint({
    request,
    codeChallenge,
    project,
  }: {
    request: McpApprovalRequest;
    codeChallenge: string;
    project: McpAuthorizeProject;
  }): Promise<string> {
    const code = randomBytes(AUTH_CODE_BYTES).toString("base64url");

    await this.#collaborators.codes.storeAuthorizationCode({
      code,
      ttlSeconds: AUTH_CODE_TTL_SECONDS,
      record: {
        projectId: project.id,
        encryptedApiKey: this.#collaborators.encrypt(project.apiKey),
        // Captured here so MCP tools that need a caller identity (governance
        // install/uninstall/rotate) can attribute audit rows to the actual
        // OAuth-flowing user instead of falling back to a project-wide
        // identity. Read at the token-exchange step.
        userId: request.approver.user.id,
        codeChallenge,
        codeChallengeMethod: request.codeChallengeMethod ?? "S256",
        // Bound here so the token endpoint can require the exchange to present
        // the exact same client_id + redirect_uri this authorization was
        // validated and approved against (RFC 6749 §4.1.3 / §3.2.1).
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        expiresAt: nowInstant().epochMilliseconds + AUTH_CODE_TTL_SECONDS * 1000,
      },
    });

    return code;
  }
}
