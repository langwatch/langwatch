import type { PrismaClient, Project } from "@prisma/client";
import { getTokenType } from "./pat-token.utils";
import { PatService } from "./pat.service";

/**
 * The result of resolving a token. Contains enough context to set up the
 * request for downstream route handlers.
 */
export type ResolvedToken =
  | {
      type: "legacy";
      project: Project & { team: { id: string; organizationId: string } };
    }
  | {
      type: "pat";
      patId: string;
      userId: string;
      organizationId: string;
      project: Project & { team: { id: string; organizationId: string } };
    };

/**
 * Strategy-based token resolver. Routes tokens to the correct verification
 * path based on prefix:
 *   - sk-lw-* → legacy project API key lookup (unchanged)
 *   - pat-lw-* → PAT lookup + project resolution
 */
export class TokenResolver {
  private readonly patService: PatService;

  constructor(private readonly prisma: PrismaClient) {
    this.patService = PatService.create(prisma);
  }

  static create(prisma: PrismaClient): TokenResolver {
    return new TokenResolver(prisma);
  }

  /**
   * Resolves a token to a project context.
   *
   * For legacy keys, projectId is implicit (from the key itself).
   * For PATs, projectId must be provided separately (from Basic Auth,
   * X-Project-Id header, or URL).
   */
  async resolve({
    token,
    projectId,
  }: {
    token: string;
    projectId?: string | null;
  }): Promise<ResolvedToken | null> {
    const tokenType = getTokenType(token);

    switch (tokenType) {
      case "legacy":
        return this.resolveLegacy(token);
      case "pat":
        return this.resolvePat(token, projectId ?? null);
      default:
        // Unknown prefix — try legacy lookup as fallback
        return this.resolveLegacy(token);
    }
  }

  private async resolveLegacy(
    apiKey: string,
  ): Promise<ResolvedToken | null> {
    const project = await this.prisma.project.findUnique({
      where: { apiKey, archivedAt: null },
      include: {
        team: { select: { id: true, organizationId: true } },
      },
    });

    if (!project) return null;

    return { type: "legacy", project };
  }

  private async resolvePat(
    token: string,
    projectId: string | null,
  ): Promise<ResolvedToken | null> {
    const pat = await this.patService.verify({ token });
    if (!pat) return null;

    if (!projectId) return null;

    // Look up the project and verify it belongs to the PAT's organization
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, archivedAt: null },
      include: {
        team: { select: { id: true, organizationId: true } },
      },
    });

    if (!project) return null;

    // Verify the project belongs to the same organization as the PAT
    if (project.team.organizationId !== pat.organizationId) return null;

    // Mark as used only after full authorization succeeds
    this.patService.markUsed({ id: pat.id });

    return {
      type: "pat",
      patId: pat.id,
      userId: pat.userId,
      organizationId: pat.organizationId,
      project,
    };
  }
}
