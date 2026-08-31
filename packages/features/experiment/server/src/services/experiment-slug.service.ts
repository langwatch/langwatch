/**
 * The slug an experiment is saved under.
 *
 * A slug is unique per project and appears in the customer's URLs, so a name
 * reused within a project cannot simply take the slug it wants. The first
 * free `-2`, `-3`, ... suffix is used instead, which is what makes a second
 * "Latency sweep" land next to the first rather than on top of it.
 *
 * The search is bounded. After a hundred tries the answer is a minted id
 * instead: an unbounded loop here would be a request that never returns, and
 * a project with a hundred experiments of one name does not need the
 * hundred-and-first to be pretty.
 */

const MAX_NUMBERED_SUFFIX = 102;

/** The one read this needs: the slugs already taken under a prefix. */
export type ExperimentSlugRepository = {
  findSlugsByPrefix(input: {
    projectId: string;
    slugPrefix: string;
    excludeId?: string;
  }): Promise<string[]>;
};

export class ExperimentSlugService {
  constructor(
    private readonly repository: ExperimentSlugRepository,
    private readonly newId: () => string,
  ) {}

  async generateUnique(input: {
    baseSlug: string;
    projectId: string;
    excludeExperimentId?: string;
  }): Promise<string> {
    const suffixPattern = new RegExp(
      `^${ExperimentSlugService.escapeRegExp(input.baseSlug)}(-\\d+)?$`,
    );
    const existing = new Set(
      (
        await this.repository.findSlugsByPrefix({
          projectId: input.projectId,
          slugPrefix: input.baseSlug,
          excludeId: input.excludeExperimentId,
        })
      ).filter((slug) => suffixPattern.test(slug)),
    );
    if (!existing.has(input.baseSlug)) return input.baseSlug;
    for (let index = 2; index <= MAX_NUMBERED_SUFFIX; index += 1) {
      const candidate = `${input.baseSlug}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }

    return `${input.baseSlug}-${this.newId()}`;
  }

  /**
   * The prefix is customer text, and it is spliced into a RegExp. Without
   * this a name containing `(` throws, and one containing `.*` would match
   * slugs it has nothing to do with.
   */
  private static escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
