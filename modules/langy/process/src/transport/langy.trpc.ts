/**
 * The server half of `langy.*` and `langyEgress.*`: each procedure binds main's permission and
 * hands the parsed input, with the person the browser session proved, to one panel operation.
 * Spec: modules/langy/specs/langy-panel-trpc.feature
 */
import { defineTrpcFact, defineTrpcRouter, type TrpcHandlerActor } from "@langwatch/api/trpc";
import {
  LangyApi,
  langyEgressTrpc,
  langyTrpc,
  type LangyPanelCaller,
} from "@langwatch/langy-contract";
import { z } from "zod";

/** The signed-in person, bound by the process under this name for every namespace. */
const sessionPersonFact = defineTrpcFact(
  "organizationSessionPerson",
  z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
);

type SessionPerson = z.infer<typeof sessionPersonFact.schema>;

function callerOf(actor: TrpcHandlerActor, person: SessionPerson): LangyPanelCaller {
  return { userId: actor.id, name: person?.name ?? null, email: person?.email ?? null };
}

export const langyTrpcTransport = defineTrpcRouter(LangyApi, langyTrpc)
  .procedure("list")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor }, person) =>
    app.listConversations({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("conversationEventsAfter")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor }, person) =>
    app.getConversationEventsAfter({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("detail")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(async ({ app, input, actor }, person) => {
    const [detail] = await app.findVisibleConversationDetails({
      ...input,
      caller: callerOf(actor, person),
    });
    return detail ?? null;
  })

  .procedure("messages")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor }, person) =>
    app.getConversationMessages({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("deleteConversation")
  .withFacts(sessionPersonFact)
  .withPermission("langy:delete")
  .handle(({ app, input, actor }, person) =>
    app.archiveConversation({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("renameConversation")
  .withFacts(sessionPersonFact)
  .withPermission("langy:update")
  .handle(({ app, input, actor }, person) =>
    app.renameConversation({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("forkConversation")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.forkConversation({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("createConversation")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.createConversationTurn({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("continueConversation")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.continueConversationTurn({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("stopTurn")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.stopPanelTurn({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("answerLocalPermission")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.answerLocalPermission({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("answerQuestion")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.answerLocalQuestion({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("setLocalPolicy")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.setLocalPolicy({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("disconnectLocalWorkspace")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.disconnectLocalWorkspace({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("getCodeAccessPreference")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor }, person) =>
    app.getCodeAccessPreference({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("localRecord")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor }, person) =>
    app.getPanelLocalRecord({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("getLocalWorkspace")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor }, person) =>
    app.getPanelLocalWorkspace({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("renewLocalControlRequest")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.renewLocalControlRequest({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("warmWorker")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.warmPanelWorker({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("modelsAllowed")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor }, person) =>
    app.getModelsAllowed({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("recordFeedback")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.recordFeedback({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("feedbackPromptShown")
  .withFacts(sessionPersonFact)
  .withPermission("langy:create")
  .handle(({ app, input, actor }, person) =>
    app.markFeedbackPromptShown({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("onConversationUpdate")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor, signal }, person) =>
    app.watchConversationUpdates({ ...input, caller: callerOf(actor, person), signal }),
  )

  .procedure("onTurnStream")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor, signal }, person) =>
    app.watchTurnStream({ ...input, caller: callerOf(actor, person), signal }),
  )
  .build();

export const langyEgressTrpcTransport = defineTrpcRouter(LangyApi, langyEgressTrpc)
  .procedure("get")
  .withFacts(sessionPersonFact)
  .withPermission("langy:view")
  .handle(({ app, input, actor }, person) =>
    app.getEgressState({ ...input, caller: callerOf(actor, person) }),
  )

  .procedure("set")
  .withFacts(sessionPersonFact)
  .withPermission("langy:manage")
  .handle(({ app, input, actor }, person) =>
    app.setEgressState({ ...input, caller: callerOf(actor, person) }),
  )
  .build();
