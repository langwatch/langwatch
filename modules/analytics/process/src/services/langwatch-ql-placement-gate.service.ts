import {
  LangWatchQLNotProvisionedError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";

import type {
  LangWatchQLAccessModelAnswer,
  LangWatchQLAccessModelAnswerRepository,
} from "../repositories/langwatch-ql-access-model-answer.repository.ts";
import type {
  LangWatchQLPlacement,
  LangWatchQLPlacementRepository,
} from "../repositories/langwatch-ql-placement.repository.ts";
import type { LwqlAccessModelOwner } from "../rules/langwatch-ql-config-store.rules.ts";

const logger = createLogger("langwatch:analytics:lwql:placement-gate");

/** Whether config names a server to hold the access model, and the probe asking that server. */
type LangWatchQLAccessModelProbe = Readonly<{
  configured: boolean;
  probeOwner(): Promise<LwqlAccessModelOwner>;
}>;

/** The server LangWatchQL queries, by origin; unconfigured where it has none. */
export type LangWatchQLPlacementTarget = Readonly<
  { configured: true; origin: string } | { configured: false }
>;

type LangWatchQLPlacementGateDeps = Readonly<{
  placement: Pick<LangWatchQLPlacementRepository, "placementOf">;
  target: LangWatchQLPlacementTarget;
  accessModel: LangWatchQLAccessModelProbe;
  /** Asks a private server, as its own reader login, whether its access model is in place. */
  privateAccessModel: LangWatchQLPrivateAccessModelProbe;
  answers: LangWatchQLAccessModelAnswerRepository;
}>;

/** The private servers' probe: one organisation's server, reached through its own route. */
type LangWatchQLPrivateAccessModelProbe = Readonly<{
  probe(input: { projectIds: readonly string[] }): Promise<LangWatchQLAccessModelAnswer>;
}>;

/** Where a run's projects are: one shared server, or one organisation's own, by origin. */
type LangWatchQLPlacedOn = Readonly<
  { kind: "shared"; origin: string } | { kind: "private"; origin: string; organizationId: string }
>;

function ownerAnswer(owner: LwqlAccessModelOwner): LangWatchQLAccessModelAnswer {
  return owner === "none" ? "not_provisioned" : "provisioned";
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The one placement gate every LangWatchQL run passes before any SQL (ADR-200): it answers only
 * where each project's rows and the provisioned access model are on the same server, and fails
 * closed. A private server is probed as its own reader login. Spec: specs/lwql/isolation.feature.
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
    const placedOn = this.#placedOn({ projectIds, placements, shared: target.origin });
    if (placedOn === null) {
      logger.warn({ projectIds }, "LangWatchQL refused: the data is not on one LangWatchQL server");
      throw new LangWatchQLNotProvisionedError();
    }
    const answer = await this.#accessModelAnswer({ projectIds, placedOn });
    if (answer === "not_provisioned") {
      logger.warn({ projectIds }, "LangWatchQL refused: no access model is provisioned");
      throw new LangWatchQLNotProvisionedError();
    }
  }

  /**
   * The one server every project's rows are on, or null where they are on several or the shared
   * ones are not the LangWatchQL server. An unresolvable placement is undecided, never shared.
   */
  #placedOn({
    projectIds,
    placements,
    shared,
  }: {
    projectIds: readonly string[];
    placements: readonly LangWatchQLPlacement[];
    shared: string;
  }): LangWatchQLPlacedOn | null {
    if (placements.some((each) => each.recordedPrivate && !each.routedPrivately)) {
      const error = new Error("An organisation recorded private has no route in this process");
      throw this.#undecided({ projectIds, error });
    }
    if (placements.length === 0) return { kind: "shared", origin: shared };
    const origins = [...new Set(placements.map((each) => each.origin))];
    if (origins.includes(null)) {
      throw this.#undecided({ projectIds, error: new Error("A project's server has no origin") });
    }
    const [origin] = origins;
    if (origin === undefined || origin === null || origins.length !== 1) return null;
    const isPrivate = placements.every((each) => each.routedPrivately);
    const isShared = placements.every((each) => !each.routedPrivately);
    if (isShared && origin === shared) return { kind: "shared", origin };
    if (!isPrivate) return null;
    // Two organisations at one origin may hold different databases: never one server's answer.
    const organizations = [...new Set(placements.map((each) => each.organizationId))];
    const [organizationId] = organizations;
    if (organizationId === undefined || organizationId === null || organizations.length !== 1) {
      return null;
    }
    return { kind: "private", origin, organizationId };
  }

  /** Config decides where it can; otherwise the fleet's answer, probing once it has expired. */
  async #accessModelAnswer({
    projectIds,
    placedOn,
  }: {
    projectIds: readonly string[];
    placedOn: LangWatchQLPlacedOn;
  }): Promise<LangWatchQLAccessModelAnswer> {
    // A private answer is the organisation's own: never the shared server's, nor another
    // organisation's on the same origin, whose reader and database are not this one's.
    const origin =
      placedOn.kind === "private"
        ? `private:${placedOn.origin}:${placedOn.organizationId}`
        : placedOn.origin;
    const { accessModel, privateAccessModel } = this.deps;
    if (placedOn.kind === "shared" && !accessModel.configured) return "not_provisioned";
    const held = await this.#decide({
      projectIds,
      read: () => this.deps.answers.findAnswer({ origin }),
    });
    if (held !== null) return held;
    const answer = await this.#decide({
      projectIds,
      read: async () =>
        placedOn.kind === "private"
          ? privateAccessModel.probe({ projectIds })
          : ownerAnswer(await accessModel.probeOwner()),
    });
    await this.#decide({
      projectIds,
      read: () => this.deps.answers.recordAnswer({ origin, answer }),
    });
    return answer;
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
