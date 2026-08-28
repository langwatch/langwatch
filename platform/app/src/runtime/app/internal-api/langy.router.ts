import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  LangyEgressTrpcApi,
  LangyTokenBuffer,
  LangyTrpcApi,
} from "@langwatch/langy-server";
import { auditLog } from "~/runtime/app/features/audit-log";
import { getApp } from "~/server/app-layer/app";
import {
  LangyUiActionService,
  type UiActionRedis,
} from "~/server/app-layer/langy/ui-actions/ui-action.service";
import { appTrpcRoot } from "~/server/api/trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "~/server/api/trpc.runtime-policy";
import { scopeLineageGuard } from "~/server/api/trpc.scope-lineage-middleware";
import { checkDeclaredPermission } from "~/server/app-layer/authz/trpc-middleware";
import {
  checkLangyMessageRateLimit,
  checkLangyWarmRateLimit,
} from "~/server/middleware/rate-limit-langy";
import { trackServerEvent } from "~/server/posthog";
import { enforceLangyAccess, refuseDemoProject } from "./langy-access.middleware";

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to the feature package, so the policy below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * Exactly the chain `protectedProcedure.input(…).permission(…)` builds, plus the
 * two gates every customer-facing Langy procedure has always carried, handed to
 * the feature so it applies the policy AFTER its own input parser: tRPC runs
 * middlewares in the order they were added, and the declared check reads its
 * scope id from the validated input. `checkDeclaredPermission` carries the authz
 * declaration the router sweep reads, so these procedures stay declared.
 *
 * The two Langy-specific gates run in this order for a reason:
 *  - demo refusal — `project:view` is granted to every authenticated user on
 *    the demo project, so a permission check alone would expose whatever Langy
 *    chat someone left there; refuse it explicitly.
 *  - `enforceLangyAccess` — the authoritative rollout gate, the SAME decision
 *    both Langy surfaces use. Last, so membership is always proven before the
 *    flag is read.
 */
const policy =
  (permission: AuthzPermission) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure)
      .use(tracerMiddleware)
      .use(loggerMiddleware)
      .use(handledErrorMiddleware)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before the declaration can pass on one id
      // while the handler acts on another.
      .use(scopeLineageGuard({ kind: "permission", permission }))
      .use(checkDeclaredPermission({ permission }))
      .use(enforcePermissionCheck)
      .use(auditLogMutations)
      .use(refuseDemoProject)
      .use(enforceLangyAccess) as unknown as TProcedure;

/**
 * The claim/complete side of the agent-to-page UI-action channel, built per
 * call on the process's shared Redis and conversation reads — the lifecycle the
 * transport has always had.
 *
 * The conversation slice is the service's own visible read: the dispatch's
 * pending record already pins project and conversation, and this is the same
 * `(owner OR shared)` rule every other Langy read applies.
 */
function createUiActionService(): LangyUiActionService {
  const app = getApp();
  const redis = app.redis as unknown as UiActionRedis;
  return new LangyUiActionService({
    redis,
    conversations: {
      findByIdVisible: (args) => app.langy.tryFindByIdVisible(args),
    },
    buffer: LangyTokenBuffer.create({ redis: app.redis }),
  });
}

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const langyRouter = LangyTrpcApi.create(
  appTrpcRoot,
  { protected: authProtectedProcedure, policy },
  {
    checkMessageRateLimit: checkLangyMessageRateLimit,
    checkWarmRateLimit: checkLangyWarmRateLimit,
    recordProductEvent: trackServerEvent,
    uiActions: {
      claim: (input) => createUiActionService().claim(input),
      complete: (input) => createUiActionService().complete(input),
    },
  },
);

/**
 * The project's Langy egress allow-list, the second transport this feature
 * owns. Mounted beside the conversation surface because both carry the same
 * process policy chain and the same feature's service; the router key stays
 * `langyEgress` so no action path moves.
 */
export const langyEgressRouter = LangyEgressTrpcApi.create(
  appTrpcRoot,
  { protected: authProtectedProcedure, policy },
  { recordAudit: auditLog },
);
