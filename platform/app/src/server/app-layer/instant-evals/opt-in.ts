/**
 * An organization's own switch for Instant Evals.
 *
 * A run sends the judged text to the judge's provider, and that is a data flow
 * an organization agrees to rather than one a release turns on for it. So a
 * self-serve organization switches Instant Evals on itself, from the popover
 * the search bar opens when a judged query is refused; an enterprise
 * organization asks us instead, and an operator switches it on through the
 * release flag once the paperwork is where the customer wants it. A
 * self-hosted install is released by the license its customer signed, when
 * that license names Instant Evals. Nothing ever opts an organization in on
 * its behalf.
 *
 * The release flag stays what it was: the operator's switch, per project or
 * organization. The flag, the license and the switch are combined in
 * `./access.ts`; this file is the organization's half, and what the popover
 * tells an organization that none of them released.
 *
 * @see ./access.ts
 * @see ../../../../../specs/instant-evals/instant-eval-opt-in.feature
 */

import { CONNECT_INSTANT_EVALS_SERVICE } from "@ee/licensing/connect/install/connectClassifier";
import { connectServiceState } from "@ee/licensing/connect/install/connectEntitlement";
import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { isEnterpriseTier } from "~/server/api/enterprise";
import { getApp } from "~/server/app-layer/app";
import type { PlanProviderUser } from "~/server/app-layer/subscription/plan-provider";
import {
  type InstantEvalJudgeRoute,
  instantEvalJudgeRoute,
} from "./classifier";
import { InstantEvalOptInNotOfferedError } from "./errors";

/**
 * What the popover offers a refused organization, to the member reading it.
 *
 * - `enable`: a self-serve organization on the hosted service, read by a
 *   member who may manage the organization and so may switch Instant Evals on
 *   for it.
 * - `ask_admin`: the same organization, read by a member who may not: the
 *   explanation is the same, but the switch is an organization admin's to
 *   throw, so the popover offers no button that the server would refuse.
 * - `contact_us`: an enterprise organization on the hosted service, whose
 *   agreement is negotiated rather than clicked.
 * - the rest are a self-hosted install, whose judging is a matter of its
 *   judge and its Connect license and not of this switch; see
 *   {@link SelfHostedInstantEvalOffer}.
 */
export type InstantEvalOptInOffer =
  | "enable"
  | "ask_admin"
  | "contact_us"
  | SelfHostedInstantEvalOffer;

/**
 * Why a self-hosted install is not released, each with its own remedy.
 *
 * - `not_in_license`: the install judges through LangWatch, and the
 *   organization's license does not name Instant Evals, or there is no
 *   license at all. A word with us adds them.
 * - `switched_off`: the license names them, and an organization admin
 *   switched hosted judging off in Settings, Connect, which is where it is
 *   switched back on.
 * - `not_connected`: Connect is switched off for the deployment, or the
 *   install holds no credential to present, so it cannot reach LangWatch.
 * - `ask_operator`: the install judges with its own key, or has judging
 *   turned off. Its operator decides, through the release flag.
 */
export type SelfHostedInstantEvalOffer =
  | "not_in_license"
  | "switched_off"
  | "not_connected"
  | "ask_operator";

/** What one organization's license says about hosted judging. */
export interface InstantEvalLicenseState {
  /** The license names Instant Evals. */
  readonly entitled: boolean;
  /** Named, and no organization admin switched them off. */
  readonly switchedOn: boolean;
}

const isHostedService = () => env.IS_SAAS === true;

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
 * Whether the organization is one the switch is offered to at all: on the
 * hosted service, and not on an enterprise plan. This is the organization's
 * half of the offer; whether the member asking may throw the switch is the
 * other half, and `instantEvalOptInOffer` puts the two together.
 *
 * The plan and the deployment are injectable so a test can state them; the
 * defaults read the process. The plan is resolved with the caller's user
 * because the SaaS provider needs it to answer at all for an impersonated
 * session.
 */
export async function instantEvalSwitchOffered({
  organizationId,
  user,
  isSaas = isHostedService,
  planTypeOf = async () =>
    (await getApp().planProvider.getActivePlan({ organizationId, user })).type,
}: {
  organizationId: string;
  user?: PlanProviderUser;
  isSaas?: () => boolean;
  planTypeOf?: () => Promise<string>;
}): Promise<boolean> {
  if (!isSaas()) return false;
  return !isEnterpriseTier(await planTypeOf());
}

/**
 * Why a self-hosted install is not released, from where its judge runs and
 * what its license says. Asked only for an install the access read already
 * refused, so a license that names Instant Evals and is switched on is not
 * the reason: what is left then is a credential the install cannot present,
 * which has the same remedy as a deployment that cannot reach LangWatch.
 *
 * The judge and the license are injectable so a test can state them; the
 * defaults read the deployment and the organization's row.
 */
export async function selfHostedInstantEvalOffer({
  prisma,
  organizationId,
  judgeRoute = instantEvalJudgeRoute,
  licenseOf = () =>
    connectServiceState({
      prisma,
      organizationId,
      service: CONNECT_INSTANT_EVALS_SERVICE,
    }),
}: {
  prisma: PrismaClient;
  organizationId: string;
  judgeRoute?: () => InstantEvalJudgeRoute;
  licenseOf?: () => Promise<InstantEvalLicenseState>;
}): Promise<SelfHostedInstantEvalOffer> {
  const route = judgeRoute();
  if (route === "off" || route === "own_key") return "ask_operator";
  if (route === "disconnected") return "not_connected";
  const license = await licenseOf();
  if (!license.entitled) return "not_in_license";
  if (!license.switchedOn) return "switched_off";
  return "not_connected";
}

/**
 * The offer for one organization, decided from its plan, the deployment, and
 * whether the member asking may throw the switch.
 *
 * Whether the member may switch is the caller's to answer, from the same
 * authority the `enable` mutation declares, so the popover never offers a
 * button the server would refuse: a member without it is told to ask an
 * organization admin instead. It is only asked once the organization itself
 * is one the switch is offered to.
 *
 * A self-hosted install is never offered the switch, and its plan is never
 * read: what it is told comes from its judge and its license instead.
 */
export async function instantEvalOptInOffer({
  prisma,
  organizationId,
  user,
  maySwitch,
  isSaas = isHostedService,
  planTypeOf,
  selfHostedOfferOf = () =>
    selfHostedInstantEvalOffer({ prisma, organizationId }),
}: {
  prisma: PrismaClient;
  organizationId: string;
  user?: PlanProviderUser;
  maySwitch: () => Promise<boolean>;
  isSaas?: () => boolean;
  planTypeOf?: () => Promise<string>;
  selfHostedOfferOf?: () => Promise<SelfHostedInstantEvalOffer>;
}): Promise<InstantEvalOptInOffer> {
  if (!isSaas()) return await selfHostedOfferOf();
  const offered = await instantEvalSwitchOffered({
    organizationId,
    isSaas,
    ...(user ? { user } : {}),
    ...(planTypeOf ? { planTypeOf } : {}),
  });
  if (!offered) return "contact_us";
  if (!(await maySwitch())) return "ask_admin";
  return "enable";
}

/**
 * The switch as the popover throws it: refused, and nothing recorded, for an
 * organization the popover offers "Contact us" to, so an enterprise
 * organization is never switched on by a request the popover did not make.
 * Returns what the access read will now say.
 *
 * The member's authority is not asked again here: the `enable` mutation
 * declares it, and a request that reached this far has passed that check. So
 * only the organization's half of the offer is checked, directly.
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
  const hosted = (isSaas ?? isHostedService)();
  const offered = await instantEvalSwitchOffered({
    organizationId,
    isSaas: () => hosted,
    ...(user ? { user } : {}),
    ...(planTypeOf ? { planTypeOf } : {}),
  });
  if (!offered) {
    throw new InstantEvalOptInNotOfferedError({
      deployment: hosted ? "enterprise" : "self_hosted",
    });
  }
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
