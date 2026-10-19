/**
 * The slug an experiment is saved under.
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
  private constructor(
    private readonly repository: ExperimentSlugRepository,
    private readonly newId: () => string,
  ) {}

  static create(options: {
    repository: ExperimentSlugRepository;
    newId: () => string;
  }): ExperimentSlugService {
    return new ExperimentSlugService(options.repository, options.newId);
  }

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
    if (!existing.has(input.baseSlug)) {
      return input.baseSlug;
    }

    for (let index = 2; index <= MAX_NUMBERED_SUFFIX; index += 1) {
      const candidate = `${input.baseSlug}-${index}`;
      if (!existing.has(candidate)) {
        return candidate;
      }
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
