// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `personalSessions.*`: a person's own CLI devices, gated on
 * `organization:view`, and their own web sessions, unpermissioned; always
 * answered for the caller alone, as on main.
 */
import { browserSessionFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, personalSessionsTrpc } from "@langwatch/enterprise-governance-contract";

export const personalSessionsTrpcTransport = defineTrpcRouter(
  GovernanceRestApi,
  personalSessionsTrpc,
)
  .procedure("list")
  .withPermission("organization:view")
  .handle(({ app, actor }) => app.cliSessionListForUser({ userId: actor.id }))

  .procedure("revoke")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.cliSessionRevoke({ userId: actor.id, sessionStartedAtMs: input.sessionStartedAtMs }),
  )

  .procedure("revokeAll")
  .withPermission("organization:view")
  .handle(({ app, actor }) => app.cliSessionRevokeAll({ userId: actor.id }))

  .procedure("listWebSessions")
  .withFacts(browserSessionFact)
  .noPermission({
    reason: "the caller's own signed-in web sessions, answered for the session's user id alone",
  })
  .handle(({ app, actor }, browserSession) =>
    app.personalWebSessionList({
      userId: actor.id,
      currentSessionId: browserSession ?? undefined,
    }),
  )

  .procedure("revokeWebSession")
  .withFacts(browserSessionFact)
  .noPermission({
    reason:
      "the caller ending one of their own sessions, matched on the session's user id; a session that is not theirs ends nothing",
  })
  .handle(({ app, actor, input }, browserSession) =>
    app.personalWebSessionEnd({
      userId: actor.id,
      sessionId: input.sessionId,
      currentSessionId: browserSession ?? undefined,
    }),
  )

  .procedure("revokeWebSessionsForIdentifier")
  .noPermission({
    reason:
      "the caller ending their own sessions, matched on the session's user id; an identifier that is not theirs ends nothing",
  })
  .handle(({ app, actor, input }) =>
    app.personalWebSessionsEndForIdentifier({
      userId: actor.id,
      identifierId: input.identifierId,
    }),
  )
  .build();
