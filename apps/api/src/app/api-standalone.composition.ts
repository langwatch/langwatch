import {
  ApiRuntimeCompositionPort,
  ApiRuntimeProcessPort,
  type ApiRuntimeCompositionOptions,
} from "../api.main";
import {
  ApiProductionComposition,
  type ApiProductionCompositionOptions,
} from "./api-production.composition";

/*
 * There is no unavailable-adapter list any more, and its removal is the point
 * rather than tidying.
 *
 * It was the executable's boot statement: a standing list of adapters no
 * package implemented, announced at WARN on every start. Entries left it one
 * at a time as each seam closed — the stored-secret cipher, the query guards,
 * the metric registry, the grant command pipeline, the organization and
 * API-key services, the agent ports, `IdentityEmailService` — until the last
 * entry was the deployment's Better Auth browser-session transport, and that
 * one outlived its own truth. {@link ApiProductionComposition.resolveAuth}
 * composes Better Auth from the deployment's own browser-session identity when
 * no host supplies a transport, so the process announced that it would mount
 * no product transports and then, on the next line, said it had composed
 * Better Auth over the stock Prisma storage engine and mounted them.
 *
 * What replaces it is what was always more accurate: each composition reports
 * the collaborator IT could not build, naming the reason it could not
 * ({@link LoggedApiAuthAbsence}, {@link LoggedApiTenancyAbsence},
 * {@link LoggedApiQueueAbsence}). A deployment that supplies nothing still
 * reads one line per absent collaborator; a deployment that supplies nothing
 * and gets a working one reads the truth instead of a contradiction.
 */

/**
 * The composition the physical API executable boots.
 *
 * It is {@link ApiProductionComposition} over this process's own validated
 * configuration, plus the one thing a composition cannot say for itself: the
 * executable's boot statement about what a deployment still has to hand it.
 *
 * It used to be two graphs. When the production composition could only be
 * HANDED a host's product services, a process with none of them had nothing to
 * compose, so this class built a second, smaller graph — a database, a queue
 * and the lifecycle surface — and the executable booted that one. Every seam
 * that has closed since (the stored-secret cipher, AuthZ over the process's
 * own producer-only Eventing, the organization/project/API-key trio, the agent
 * service, the Auth service) is composed by the production composition and by
 * nothing else, so the graph the executable actually booted could never reach
 * any of it. A deployment with a database, a Redis and a Better Auth transport
 * would still have served a health route and no product traffic.
 *
 * So there is one graph now, and a host's services are an OVERRIDE of what
 * this process would compose rather than the gate deciding which graph exists.
 * Degrading is the production composition's own job and it already does it:
 * each collaborator it cannot build is named at boot and it falls back to the
 * lifecycle surface — listener, readiness gate, health route, optional metrics
 * route and bounded drain.
 */
export class ApiStandaloneComposition extends ApiRuntimeCompositionPort {
  static create(options: ApiProductionCompositionOptions = {}): ApiStandaloneComposition {
    return new ApiStandaloneComposition(options);
  }

  private constructor(private readonly options: ApiProductionCompositionOptions) {
    super();
  }

  compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcessPort> {
    return ApiProductionComposition.create(this.options).compose(options);
  }
}
