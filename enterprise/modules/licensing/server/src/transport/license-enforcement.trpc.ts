/**
 * The server half of `licenseEnforcement.*`. Reading a limit takes
 * `organization:view`, which every member holds: a member who cannot invite
 * anybody should still be told the seats are full, not shown a control that fails.
 */
import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { LicensingApi, licenseEnforcementTrpc } from "@langwatch/enterprise-licensing-contract";
import { z } from "zod";

/**
 * The caller's address, as the PROCESS resolves it. A fact rather than part of
 * the actor: an operator allow-list is keyed by address, so an allowance that
 * saw an id alone would meter the people this deployment exempts.
 */
export const callerEmailFact = defineTrpcFact("callerEmail", z.string().nullable());

export const licenseEnforcementTrpcTransport = defineTrpcRouter(
  LicensingApi,
  licenseEnforcementTrpc,
)
  .procedure("checkLimit")
  .withFacts(callerEmailFact)
  .withPermission("organization:view")
  .handle(({ app, input, actor }, email) =>
    app.checkLimit({
      organizationId: input.organizationId,
      limitType: input.limitType,
      user: { id: actor.id, email },
    }),
  )

  .procedure("checkAllLimits")
  .withFacts(callerEmailFact)
  .withPermission("organization:view")
  .handle(({ app, input, actor }, email) =>
    app.checkAllLimits({
      organizationId: input.organizationId,
      user: { id: actor.id, email },
    }),
  )

  // Fire-and-forget from the client's side. The application re-checks the limit
  // itself, so a fabricated request cannot raise a false alert.
  .procedure("reportLimitBlocked")
  .withFacts(callerEmailFact)
  .withPermission("organization:view")
  .handle(({ app, input, actor }, email) =>
    app.reportLimitBlocked({
      organizationId: input.organizationId,
      limitType: input.limitType,
      user: { id: actor.id, email },
    }),
  )
  .build();
