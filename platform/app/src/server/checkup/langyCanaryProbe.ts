/**
 * The checkup's Langy canary.
 *
 * Langy acts as a person, so the greeting turn is sent as the administrator
 * who asked for the checkup. Whether Langy is open to them is answered by
 * `hasLangyAccess`, the same gate the Langy panel and the turn routes use, so
 * the checkup can never call Langy off where the panel answers.
 *
 * The turn runs in process through the same service the `/api/health/langy`
 * probe uses. That probe also sits behind the key-authed Langy API surface,
 * which is a separate switch from Langy itself.
 */

import { hasLangyAccess } from "~/server/app-layer/langy/langyAccessGate";
import type { Session } from "~/server/auth";
import type { featureFlagService } from "~/server/featureFlag";
import type { LangyCanaryResult } from "~/server/health-probes/langy-canary.service";
import type { LangyCanaryProbe } from "./checkup.service";

export interface LangyCanaryProbeInput {
  /** The user the check runs as; null when no person asked for it. */
  readonly actorUserId: string | null;
  readonly organizationId: string;
  readonly project: () => Promise<{ id: string } | null>;
  readonly resolveActor: (userId: string) => Promise<Session | null>;
  readonly run: (input: {
    projectId: string;
    session: Session;
  }) => Promise<LangyCanaryResult>;
  readonly flags?: Pick<typeof featureFlagService, "isEnabled">;
}

export async function probeLangyCanary({
  actorUserId,
  organizationId,
  project,
  resolveActor,
  run,
  flags,
}: LangyCanaryProbeInput): Promise<LangyCanaryProbe> {
  if (!actorUserId) return { kind: "no_actor" };

  const target = await project();
  if (!target) {
    return {
      kind: "answered",
      answer: { status: 412, body: { message: "no project" } },
    };
  }

  const allowed = await hasLangyAccess({
    user: { id: actorUserId },
    projectId: target.id,
    organizationId,
    ...(flags ? { flags } : {}),
  });
  if (!allowed) return { kind: "no_access" };

  const session = await resolveActor(actorUserId);
  if (!session) return { kind: "no_actor" };

  const result = await run({ projectId: target.id, session });
  if ("busy" in result) {
    return {
      kind: "answered",
      answer: {
        status: 429,
        body: { message: "another Langy canary is still running" },
      },
    };
  }
  if (result.healthy) {
    return { kind: "answered", answer: { status: 200, body: result } };
  }
  return {
    kind: "answered",
    answer: { status: 503, body: { message: result.reason } },
  };
}
