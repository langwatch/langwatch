import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  EVALUATOR_SEEDED_LABELS,
  EvaluatorDeployedLabelProtectedError,
  EvaluatorLabelInvalidError,
  EvaluatorNotFoundError,
  EvaluatorVersionNotFoundError,
  EvaluatorVersionSelectorConflictError,
  checkEvaluatorLabel,
  evaluatorSchema,
  parseEvaluatorAddress,
  type Evaluator,
  type EvaluatorCaller,
  type EvaluatorLabel,
  type EvaluatorVersion,
  type EvaluatorVersions,
  type EvaluatorVersionSelector,
} from "@langwatch/evaluator-contract";
import { toDate } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type {
  EvaluatorRepository,
  EvaluatorVersionRecord,
} from "../repositories/evaluator.repository.ts";

/** An evaluator as one of its versions holds it, and that version's number. */
export type ResolvedEvaluatorVersion = { evaluator: Evaluator; version: number | null };

const BACKFILL_PAGE = 200;

type Dependencies = {
  repository: EvaluatorRepository;
  users: Pick<UserApi, "getProfiles">;
  permissions: Pick<AuthzApi, "can" | "getScope">;
  auditLog: Pick<AuditLogApi, "listEntityHistory">;
};

/** Versions, deploy labels and the deploy check of evaluators (evaluator-versioning.feature). */
export class EvaluatorVersionService {
  readonly #deps: Dependencies;

  private constructor(deps: Dependencies) {
    this.#deps = deps;
  }

  static create(deps: Dependencies): EvaluatorVersionService {
    return new EvaluatorVersionService(deps);
  }

  async listVersions(input: {
    projectId: string;
    evaluatorId: string;
  }): Promise<EvaluatorVersions> {
    await this.#require({ id: input.evaluatorId, projectId: input.projectId });
    const [versions, labels] = await Promise.all([
      this.#deps.repository.findVersions(input),
      this.#deps.repository.findLabels({ projectId: input.projectId, ids: [input.evaluatorId] }),
    ]);
    const people = await this.#people(
      versions.flatMap((row) => (row.authorId ? [row.authorId] : [])),
    );
    const labelsByVersion = new Map<string, string[]>();
    for (const label of labels) {
      labelsByVersion.set(label.versionId, [
        ...(labelsByVersion.get(label.versionId) ?? []),
        label.label,
      ]);
    }

    return {
      versions: versions.map((row): EvaluatorVersion => ({
        ...row,
        createdAt: toDate(row.createdAt),
        author: row.authorId ? (people.get(row.authorId) ?? null) : null,
        labels: labelsByVersion.get(row.id) ?? [],
      })),
      labels: labels.map(({ evaluatorId: _evaluatorId, ...label }): EvaluatorLabel => ({
        ...label,
        updatedAt: toDate(label.updatedAt),
      })),
      availableLabels: [
        ...new Set([...EVALUATOR_SEEDED_LABELS, ...labels.map((row) => row.label)]),
      ],
    };
  }

  /**
   * The evaluator at a label or version, from `?label=`/`?version=` or the `idOrSlug:label`
   * address. `bySlug` lets the address name a slug, as the evaluation API does.
   */
  async resolve(
    input: { projectId: string; address: string; bySlug: boolean } & EvaluatorVersionSelector,
  ): Promise<ResolvedEvaluatorVersion> {
    const address = parseEvaluatorAddress(input.address);
    const asked = [input.label, input.version].filter((value) => value !== void 0).length;
    if (asked > 1 || (address.hadSuffix && asked > 0)) {
      throw new EvaluatorVersionSelectorConflictError();
    }
    const evaluator = input.bySlug
      ? await this.#deps.repository.findByIdOrSlug({
          idOrSlug: address.idOrSlug,
          projectId: input.projectId,
        })
      : await this.#deps.repository.findById({ id: address.idOrSlug, projectId: input.projectId });
    if (!evaluator) throw new EvaluatorNotFoundError(address.idOrSlug);
    const label = address.label ?? input.label;
    const version = address.version ?? input.version;
    if (label === void 0 && version === void 0) {
      const latest = await this.#deps.repository.latestVersionNumbers({
        projectId: input.projectId,
        ids: [evaluator.id],
      });
      return { evaluator, version: latest.get(evaluator.id) ?? null };
    }

    const row = await this.#versionAt({ evaluator, label, version });
    return {
      evaluator: evaluatorSchema.parse({
        ...evaluator,
        name: row.name,
        type: row.type,
        config: row.config,
        workflowId: row.workflowId,
      }),
      version: row.version,
    };
  }

  /** The evaluator at a label, or the latest when the label points nowhere (a monitor's pin). */
  async atLabelOrLatest(input: { evaluator: Evaluator; label: string }): Promise<Evaluator> {
    const [label] = (
      await this.#deps.repository.findLabels({
        projectId: input.evaluator.projectId,
        ids: [input.evaluator.id],
      })
    ).filter((row) => row.label === input.label);
    if (!label) return input.evaluator;
    const row = await this.#deps.repository.findVersion({
      projectId: input.evaluator.projectId,
      evaluatorId: input.evaluator.id,
      versionId: label.versionId,
    });
    if (!row) return input.evaluator;
    return evaluatorSchema.parse({
      ...input.evaluator,
      name: row.name,
      type: row.type,
      config: row.config,
      workflowId: row.workflowId,
      version: row.version,
    });
  }

  async assignLabel(input: {
    projectId: string;
    evaluatorId: string;
    label: string;
    version: number;
    caller?: EvaluatorCaller;
  }): Promise<EvaluatorLabel> {
    const check = checkEvaluatorLabel(input.label);
    if (!check.valid) {
      throw new EvaluatorLabelInvalidError({ label: input.label, reason: check.reason });
    }
    await this.#require({ id: input.evaluatorId, projectId: input.projectId });
    const row = await this.#deps.repository.findVersion({
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      version: input.version,
    });
    if (!row) {
      throw new EvaluatorVersionNotFoundError({
        evaluatorId: input.evaluatorId,
        version: input.version,
      });
    }
    const { evaluatorId: _evaluatorId, ...label } = await this.#deps.repository.assignLabel({
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      label: input.label,
      versionId: row.id,
      actorId: input.caller?.type === "user" ? input.caller.id : null,
    });
    return { ...label, updatedAt: toDate(label.updatedAt) };
  }

  async removeLabel(input: {
    projectId: string;
    evaluatorId: string;
    label: string;
  }): Promise<void> {
    await this.#require({ id: input.evaluatorId, projectId: input.projectId });
    const removed = await this.#deps.repository.removeLabel(input);
    if (!removed) {
      throw new EvaluatorVersionNotFoundError({
        evaluatorId: input.evaluatorId,
        label: input.label,
      });
    }
  }

  /** The latest number and the labels of each evaluator, for list rows. */
  async summaries(input: {
    projectId: string;
    ids: string[];
  }): Promise<
    Map<string, { version: number | null; labels: { label: string; version: number }[] }>
  > {
    const [numbers, labels] = await Promise.all([
      this.#deps.repository.latestVersionNumbers(input),
      this.#deps.repository.findLabels(input),
    ]);
    return new Map(
      input.ids.map((id) => [
        id,
        {
          version: numbers.get(id) ?? null,
          labels: labels
            .filter((label) => label.evaluatorId === id)
            .map(({ label, version }) => ({ label, version })),
        },
      ]),
    );
  }

  /** The people behind ids, by name, falling back to their email. */
  async peopleNamed(ids: string[]): Promise<Map<string, { id: string; name: string | null }>> {
    const people = await this.#people(ids);
    return new Map(
      [...people.values()].map((person) => [
        person.id,
        { id: person.id, name: person.name ?? person.email },
      ]),
    );
  }

  /**
   * Deleting an evaluator a label points at needs `evaluators:deploy`; the check depends on
   * the loaded row, so the service asks it. A peer's cascade names no caller and is not asked.
   */
  async assertDeletable(input: {
    projectId: string;
    evaluatorId: string;
    caller: EvaluatorCaller | undefined;
  }): Promise<void> {
    if (!input.caller || input.caller.type === "system") return;
    const labels = await this.#deps.repository.findLabels({
      projectId: input.projectId,
      ids: [input.evaluatorId],
    });
    if (labels.length === 0) return;
    const { caller } = input;
    const permitted =
      caller.type !== "unattributed" &&
      (await this.#deps.permissions.can({
        principal:
          caller.type === "user"
            ? { type: "user", id: caller.id }
            : { type: "apiKey", id: caller.id },
        permission: "evaluators:deploy",
        scope: await this.#deps.permissions.getScope({ projectId: input.projectId }),
      }));
    if (!permitted) {
      throw new EvaluatorDeployedLabelProtectedError({
        evaluatorId: input.evaluatorId,
        labels: labels.map((label) => label.label),
      });
    }
  }

  /**
   * Version 1 for every evaluator written before versions existed, its creator read from the
   * earliest `evaluators.create` audit entry. Writes nothing on a dry run; a re-run writes nothing.
   */
  async backfill(input: {
    dryRun: boolean;
    signal: AbortSignal;
    afterId: string | null;
    onPage: (report: { afterId: string; written: number; scanned: number }) => Promise<void>;
  }): Promise<{ written: number; scanned: number; wouldWrite: number }> {
    let afterId = input.afterId;
    let written = 0;
    let scanned = 0;
    let wouldWrite = 0;
    while (!input.signal.aborted) {
      const page = await this.#deps.repository.findUnversioned({ afterId, limit: BACKFILL_PAGE });
      if (page.length === 0) break;
      const done = await this.#backfillPage({ page, dryRun: input.dryRun });
      scanned += page.length;
      written += done.written;
      wouldWrite += done.wouldWrite;
      afterId = page.at(-1)!.id;
      if (!input.dryRun) await input.onPage({ afterId, written, scanned });
    }
    return { written, scanned, wouldWrite };
  }

  async #backfillPage(input: {
    page: Evaluator[];
    dryRun: boolean;
  }): Promise<{ written: number; wouldWrite: number }> {
    let written = 0;
    let wouldWrite = 0;
    for (const evaluator of input.page) {
      if (input.dryRun) {
        if (!(await this.#hasVersions(evaluator))) wouldWrite += 1;
        continue;
      }
      const createdById = evaluator.createdById ?? (await this.#creatorOf(evaluator));
      if (await this.#deps.repository.backfillFirstVersion({ evaluator, createdById })) {
        written += 1;
      }
    }
    return { written, wouldWrite };
  }

  async #hasVersions(evaluator: Evaluator): Promise<boolean> {
    const numbers = await this.#deps.repository.latestVersionNumbers({
      projectId: evaluator.projectId,
      ids: [evaluator.id],
    });
    return numbers.has(evaluator.id);
  }

  async #creatorOf(evaluator: Evaluator): Promise<string | null> {
    const entries = await this.#deps.auditLog.listEntityHistory({
      projectId: evaluator.projectId,
      entityId: evaluator.id,
      argumentNames: ["id", "evaluatorId"],
      actionPrefix: "evaluators.create",
      limit: 100,
    });
    const [earliest] = entries
      .filter((entry) => entry.action === "evaluators.create" && entry.userId)
      .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return earliest?.userId ?? null;
  }

  async #require(input: { id: string; projectId: string }): Promise<Evaluator> {
    const evaluator = await this.#deps.repository.findById(input);
    if (!evaluator) throw new EvaluatorNotFoundError(input.id);
    return evaluator;
  }

  async #versionAt(input: {
    evaluator: Evaluator;
    label: string | undefined;
    version: number | undefined;
  }): Promise<EvaluatorVersionRecord> {
    const { evaluator } = input;
    if (input.version !== void 0) {
      const row = await this.#deps.repository.findVersion({
        projectId: evaluator.projectId,
        evaluatorId: evaluator.id,
        version: input.version,
      });
      if (!row) {
        throw new EvaluatorVersionNotFoundError({
          evaluatorId: evaluator.id,
          version: input.version,
        });
      }
      return row;
    }
    const [label] = (
      await this.#deps.repository.findLabels({
        projectId: evaluator.projectId,
        ids: [evaluator.id],
      })
    ).filter((row) => row.label === input.label);
    const row = label
      ? await this.#deps.repository.findVersion({
          projectId: evaluator.projectId,
          evaluatorId: evaluator.id,
          versionId: label.versionId,
        })
      : void 0;
    if (!row) {
      throw new EvaluatorVersionNotFoundError({ evaluatorId: evaluator.id, label: input.label });
    }
    return row;
  }

  async #people(ids: string[]) {
    const unique = [...new Set(ids)];
    const users = unique.length ? await this.#deps.users.getProfiles({ userIds: unique }) : [];
    return new Map(
      users.map((user) => [user.id, { id: user.id, name: user.name, email: user.email }]),
    );
  }
}
