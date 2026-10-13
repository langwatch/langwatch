/**
 * The server half of `langy.*` and `langyEgress.*`: each procedure binds main's permission and
 * hands the parsed input, with the person the browser session proved, to one panel operation.
 * Spec: modules/langy/specs/langy-panel-trpc.feature
 */
import {
  defineMiddlewareContext,
  defineTrpcRouter,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import {
  LangyApi,
  langyEgressTrpc,
  langyTrpc,
  type LangyPanelCaller,
} from "@langwatch/langy-contract";
import { z } from "zod";

/** The signed-in person, bound by the process under this name for every namespace. */
const sessionPersonContext = defineMiddlewareContext(
  "organizationSessionPerson",
  z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
);

type SessionPerson = z.infer<typeof sessionPersonContext.schema>;

function callerOf(actor: TrpcHandlerActor, person: SessionPerson): LangyPanelCaller {
  return { userId: actor.id, name: person?.name ?? null, email: person?.email ?? null };
}

export const langyTrpcTransport: TrpcRouterDeclaration<LangyApi, typeof langyTrpc> =
  defineTrpcRouter(LangyApi, langyTrpc)
    .procedure("list")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor }, person) =>
      app.listConversations({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("conversationEventsAfter")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor }, person) =>
      app.getConversationEventsAfter({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("detail")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(async ({ app, input, actor }, person) => {
      const [detail] = await app.findVisibleConversationDetails({
        ...input,
        caller: callerOf(actor, person),
      });
      return detail ?? null;
    })

    .procedure("messages")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor }, person) =>
      app.getConversationMessages({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("deleteConversation")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:delete")
    .handle(({ app, input, actor }, person) =>
      app.archiveConversation({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("renameConversation")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:update")
    .handle(({ app, input, actor }, person) =>
      app.renameConversation({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("forkConversation")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.forkConversation({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("createConversation")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.createConversationTurn({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("continueConversation")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.continueConversationTurn({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("stopTurn")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.stopPanelTurn({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("claimUiAction")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor }, person) =>
      app.claimUiAction({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("completeUiAction")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor }, person) =>
      app.completeUiAction({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("answerLocalPermission")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.answerLocalPermission({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("answerQuestion")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.answerLocalQuestion({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("setLocalPolicy")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.setLocalPolicy({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("disconnectLocalWorkspace")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.disconnectLocalWorkspace({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("setCodeAccessPreference")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:update")
    .handle(({ app, input, actor }, person) =>
      app.setCodeAccessPreference({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("getCodeAccessPreference")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor }, person) =>
      app.getCodeAccessPreference({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("localRecord")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor }, person) =>
      app.getPanelLocalRecord({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("getLocalWorkspace")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor }, person) =>
      app.getPanelLocalWorkspace({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("renewLocalControlRequest")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.renewLocalControlRequest({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("warmWorker")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.warmPanelWorker({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("modelsAllowed")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor }, person) =>
      app.getModelsAllowed({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("recordFeedback")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.recordFeedback({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("feedbackPromptShown")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:create")
    .handle(({ app, input, actor }, person) =>
      app.markFeedbackPromptShown({ ...input, caller: callerOf(actor, person) }),
    )

    .procedure("onConversationUpdate")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor, signal }, person) =>
      app.watchConversationUpdates({ ...input, caller: callerOf(actor, person), signal }),
    )

    .procedure("onTurnStream")
    .withMiddlewareContext(sessionPersonContext)
    .withPermission("langy:view")
    .handle(({ app, input, actor, signal }, person) =>
      app.watchTurnStream({ ...input, caller: callerOf(actor, person), signal }),
    )
    .build();

export const langyEgressTrpcTransport = defineTrpcRouter(LangyApi, langyEgressTrpc)
  .procedure("get")
  .withMiddlewareContext(sessionPersonContext)
  .withPermission("langy:view")
  .handle(({ app, input, actor }, person) =>
    app.getEgressState({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("set")
  .withMiddlewareContext(sessionPersonContext)
  .withPermission("langy:manage")
  .handle(({ app, input, actor }, person) =>
    app.setEgressState({ ...input, caller: callerOf(actor, person) }),
  )
  .build();
