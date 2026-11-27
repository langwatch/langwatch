/**
 * The `project:reslug-reserved-dashboards` step: a project whose slug became a top-level address
 * after it was minted gets the slug minting gives today, `<name>-<id token>`. Only slugs minted
 * without the id suffix can be affected. Spec: dashboards-organization-area.feature.
 */
import type { ProjectRepository, ProjectSlugHolder } from "../repositories/project.repository.ts";
import { mintProjectSlug, projectIdSlugToken } from "../rules/project-slug-service.rules.ts";

/** Top-level addresses reserved after projects could already hold them as their slug. */
export const LATE_RESERVED_SLUGS: readonly string[] = ["dashboards"];

/** How many slugs a holder tries before the step gives up on it. */
const MAX_SLUG_ATTEMPTS = 10;

export type ReservedSlugReport = { reslugged: number; wouldReslug: number };

type Dependencies = Readonly<{
  projects: Pick<ProjectRepository, "findSlugHolders" | "replaceSlug">;
}>;

/**
 * Level-triggered: it reads who holds a reserved slug now, so a second run finds nobody and
 * changes nothing. The move is conditional on the slug still being the reserved one.
 */
export class ProjectReservedSlugService {
  private constructor(private readonly deps: Dependencies) {}

  static create(deps: Dependencies): ProjectReservedSlugService {
    return new ProjectReservedSlugService(deps);
  }

  async reslugReserved({
    dryRun,
    signal,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
  }): Promise<ReservedSlugReport> {
    const report: ReservedSlugReport = { reslugged: 0, wouldReslug: 0 };
    for (const reserved of LATE_RESERVED_SLUGS) {
      if (signal.aborted) break;
      const holders = await this.deps.projects.findSlugHolders({ slug: reserved });
      if (dryRun) {
        report.wouldReslug += holders.length;
        continue;
      }
      for (const holder of holders) {
        if (await this.#move({ holder, from: reserved })) report.reslugged += 1;
      }
    }
    return report;
  }

  /**
   * Moves one holder to the slug minting gives it, or, where another project took that, to it
   * with a further `-2`, `-3` suffix, so a collision never fails every retry of the step.
   */
  async #move({ holder, from }: { holder: ProjectSlugHolder; from: string }): Promise<boolean> {
    const minted = mintProjectSlug(holder.name, projectIdSlugToken(holder.id));
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const to = attempt === 1 ? minted : `${minted}-${attempt}`;
      const move = await this.deps.projects.replaceSlug({ projectId: holder.id, from, to });
      if (move !== "taken") return move === "moved";
    }
    throw new Error(`Every slug tried for project ${holder.id} is taken`);
  }
}
