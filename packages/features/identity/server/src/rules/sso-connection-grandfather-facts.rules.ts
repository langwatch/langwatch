import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  type GrandfatherConnectionCommandData,
  normalizeDomain,
  type SsoConnectionFactInput,
} from "@langwatch/identity-contract";

/**
 * The history a legacy connection would have had, stated in one go: the
 * registration, then a claim/approval/verification for each configured
 * domain, then the activation those years of sign-ins already earned.
 *
 * Pure on purpose — the guard decides WHETHER to grandfather; this only says
 * what grandfathering LOOKS like, which is what makes the shape reviewable
 * beside the lifecycle it replays.
 */
export function grandfatheredConnectionFacts(
  data: GrandfatherConnectionCommandData,
): SsoConnectionFactInput[] {
  const { connectionId, actor, source } = data;
  const domains = data.domains.map(normalizeDomain);
  return [
    {
      type: CONNECTION_REGISTERED_EVENT_TYPE,
      data: {
        connectionId,
        organizationId: data.organizationId,
        type: data.type,
        idp: data.idp,
        allowsJit: data.allowsJit,
        actor,
        source,
      },
    },
    ...domains.flatMap((domain: string): SsoConnectionFactInput[] => [
      {
        type: DOMAIN_CLAIMED_EVENT_TYPE,
        data: { connectionId, domain, actor, source },
      },
      {
        type: DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
        data: { connectionId, domain, actor, source },
      },
      {
        type: DOMAIN_VERIFIED_EVENT_TYPE,
        data: {
          connectionId,
          domain,
          method: "legacy-configuration",
          actor,
          source,
        },
      },
    ]),
    {
      type: CONNECTION_ACTIVATED_EVENT_TYPE,
      data: {
        connectionId,
        // The years of production sign-ins the strings already served are
        // the test login; naming a single account would be a fiction.
        testLoginAccountId: null,
        actor,
        source,
      },
    },
  ];
}
