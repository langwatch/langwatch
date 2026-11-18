import {
  LangWatchQLNotProvisionedError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";

import type {
  LangWatchQLAccessModelAnswer,
  LangWatchQLAccessModelAnswerRepository,
} from "../repositories/langwatch-ql-access-model-answer.repository.ts";
import type { LangWatchQLPlacementRepository } from "../repositories/langwatch-ql-placement.repository.ts";
import type { LwqlAccessModelOwner } from "../rules/langwatch-ql-config-store.rules.ts";

const logger = createLogger("langwatch:analytics:lwql:placement-gate");

/** Whether config names a server to hold the access model, and the probe the worker asks it. */
type LangWatchQLAccessModelProbe = Readonly<{
  configured: boolean;
  /** Null where the process holds no system credential to read `system.*` with. */
  probeOwner: (() => Promise<LwqlAccessModelOwner>) | null;
}>;

/** The server LangWatchQL queries, by origin; unconfigured where it has none. */
export type LangWatchQLPlacementTarget = Readonly<
  { configured: true; origin: string } | { configured: false }
>;

type LangWatchQLPlacementGateDeps = Readonly<{
  placement: Pick<LangWatchQLPlacementRepository, "placementOf">;
  target: LangWatchQLPlacementTarget;
  accessModel: LangWatchQLAccessModelProbe;
  answers: LangWatchQLAccessModelAnswerRepository;
}>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The one placement gate every LangWatchQL run passes before any SQL (ADR-200): it answers only
 * where each project's rows and the provisioned access model are on the same server, and fails
 * closed. Spec: specs/lwql/isolation.feature.
 */
export class LangWatchQLPlacementGateService {
  private constructor(private readonly deps: LangWatchQLPlacementGateDeps) {}

  static create(deps: LangWatchQLPlacementGateDeps): LangWatchQLPlacementGateService {
    return new LangWatchQLPlacementGateService(deps);
  }

  /** Refuses `lwql_not_provisioned` where it cannot answer, `lwql_unavailable` where undecided. */
  async admit({ projectIds }: { projectIds: readonly string[] }): Promise<void> {
    const target = this.deps.target;
    if (!target.configured) {
      throw this.#undecided({
        projectIds,
        error: new Error("No LangWatchQL server is configured"),
      });
    }
    const placements = await this.#decide({
      projectIds,
      read: () =>
        Promise.all(projectIds.map((tenantId) => this.deps.placement.placementOf({ tenantId }))),
    });
    if (placements.some((each) => each.recordedPrivate && !each.routedPrivately)) {
      const error = new Error("An organisation recorded private has no route in this process");
      throw this.#undecided({ projectIds, error });
    }
    if (placements.some((each) => each.origin === null)) {
      throw this.#undecided({ projectIds, error: new Error("A project's server has no origin") });
    }
    const elsewhere = projectIds.filter(
      (_, index) =>
        placements[index]?.routedPrivately === true || placements[index]?.origin !== target.origin,
    );
    if (elsewhere.length > 0) {
      logger.warn(
        { projectIds: elsewhere },
        "LangWatchQL refused: the project's data is not on the LangWatchQL server",
      );
      throw new LangWatchQLNotProvisionedError();
    }
    const answer = await this.#accessModelAnswer({ projectIds, origin: target.origin });
    if (answer === null) {
      logger.warn(
        { projectIds },
        "LangWatchQL refused: not provisioned yet, as no worker has stored whether an access model is provisioned",
      );
      throw new LangWatchQLNotProvisionedError();
    }
    if (answer === "not_provisioned") {
      logger.warn({ projectIds }, "LangWatchQL refused: no access model is provisioned");
      throw new LangWatchQLNotProvisionedError();
    }
  }

  /**
   * The worker's probe, stored for every gate in the fleet; nothing where config names no
   * server or the process cannot probe. A failed probe or store throws to the caller.
   */
  async refreshAccessModelAnswer(): Promise<void> {
    const { target, accessModel, answers } = this.deps;
    if (!target.configured || !accessModel.configured || accessModel.probeOwner === null) return;
    const owner = await accessModel.probeOwner();
    await answers.recordAnswer({
      origin: target.origin,
      answer: owner === "none" ? "not_provisioned" : "provisioned",
    });
  }

  /** Config decides where it can; otherwise the worker's stored answer: the gate never probes. */
  async #accessModelAnswer({
    projectIds,
    origin,
  }: {
    projectIds: readonly string[];
    origin: string;
  }): Promise<LangWatchQLAccessModelAnswer | null> {
    if (!this.deps.accessModel.configured) return "not_provisioned";
    return this.#decide({ projectIds, read: () => this.deps.answers.findAnswer({ origin }) });
  }

  /** A read the gate cannot complete refuses: never a fallback to the shared server. */
  async #decide<T>({
    projectIds,
    read,
  }: {
    projectIds: readonly string[];
    read: () => Promise<T>;
  }): Promise<T> {
    try {
      return await read();
    } catch (error) {
      throw this.#undecided({ projectIds, error });
    }
  }

  #undecided({
    projectIds,
    error,
  }: {
    projectIds: readonly string[];
    error: unknown;
  }): LangWatchQLUnavailableError {
    logger.error({ projectIds, error }, "LangWatchQL refused: the placement gate cannot decide");
    return new LangWatchQLUnavailableError({ reasons: [toError(error)] });
  }
}
