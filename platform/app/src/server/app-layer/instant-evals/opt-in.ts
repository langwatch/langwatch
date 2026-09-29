/**
 * An organization's own switch for Instant Evals.
 *
 * A run sends the judged text to the judge's provider, TypeSafe, and that is a
 * data flow an organization agrees to rather than one a release turns on for
 * it. So a self-serve organization switches Instant Evals on itself, from the
 * popover the search bar opens when a judged query is refused; an enterprise
 * organization asks us instead, and an operator switches it on through the
 * release flag once the paperwork is where the customer wants it. Nothing ever
 * opts an organization in on its behalf.
 *
 * The release flag stays what it was: the operator's switch, per project or
 * organization. The two are combined in `./access.ts`; this file is only the
 * organization's half.
 *
 * @see ./access.ts
 * @see ../../../../../specs/instant-evals/instant-eval-opt-in.feature
 */

import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { isEnterpriseTier } from "~/server/api/enterprise";
import { getApp } from "~/server/app-layer/app";
import type { PlanProviderUser } from "~/server/app-layer/subscription/plan-provider";
import { InstantEvalOptInNotOfferedError } from "./errors";

/**
 * What the popover offers a refused organization.
 *
 * - `enable`: a self-serve organization on the hosted service, which may switch
 *   Instant Evals on itself.
 * - `contact_us`: an enterprise organization, whose agreement is negotiated
 *   rather than clicked; and any self-hosted install, whose judging is a matter
 *   of its own key or its Connect license and not of this switch.
 */
export type InstantEvalOptInOffer = "enable" | "contact_us";

/** Whether the organization switched Instant Evals on itself. */
export async function instantEvalsOptedIn({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): Promise<boolean> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { instantEvalsEnabledAt: true },
  });
  return !!organization?.instantEvalsEnabledAt;
}

/**
 * The offer for one organization, decided from its plan and the deployment.
 *
 * Both are injectable so a test can state them; the defaults read the process.
 * The plan is resolved with the caller's user because the SaaS provider needs
 * it to answer at all for an impersonated session.
 */
export async function instantEvalOptInOffer({
  organizationId,
  user,
  isSaas = () => env.IS_SAAS === true,
  planTypeOf = async () =>
    (await getApp().planProvider.getActivePlan({ organizationId, user })).type,
}: {
  organizationId: string;
  user?: PlanProviderUser;
  isSaas?: () => boolean;
  planTypeOf?: () => Promise<string>;
}): Promise<InstantEvalOptInOffer> {
  if (!isSaas()) return "contact_us";
  if (isEnterpriseTier(await planTypeOf())) return "contact_us";
  return "enable";
}

/**
 * The switch as the popover throws it: refused, and nothing recorded, for an
 * organization the popover offers "Contact us" to, so an enterprise
 * organization is never switched on by a request the popover did not make.
 * Returns what the access read will now say.
 */
export async function switchInstantEvalsOn({
  prisma,
  organizationId,
  userId,
  user,
  isSaas,
  planTypeOf,
  now,
}: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  user?: PlanProviderUser;
  isSaas?: () => boolean;
  planTypeOf?: () => Promise<string>;
  now?: () => Date;
}): Promise<{ released: true; offer: "enable" }> {
  const offer = await instantEvalOptInOffer({
    organizationId,
    ...(user ? { user } : {}),
    ...(isSaas ? { isSaas } : {}),
    ...(planTypeOf ? { planTypeOf } : {}),
  });
  if (offer !== "enable") throw new InstantEvalOptInNotOfferedError();
  await enableInstantEvals({
    prisma,
    organizationId,
    userId,
    ...(now ? { now } : {}),
  });
  return { released: true, offer: "enable" };
}

/**
 * Switches Instant Evals on for the organization, once. A second click keeps
 * the first record: the moment and the member that count are the ones that
 * gave the agreement.
 */
export async function enableInstantEvals({
  prisma,
  organizationId,
  userId,
  now = () => new Date(),
}: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  now?: () => Date;
}): Promise<void> {
  await prisma.organization.updateMany({
    where: { id: organizationId, instantEvalsEnabledAt: null },
    data: {
      instantEvalsEnabledAt: now(),
      instantEvalsEnabledByUserId: userId,
    },
  });
}
