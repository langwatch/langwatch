/**
 * The server half of the process-manager fleet procedures.
 *
 * Platform-tier throughout: see `ops-operator.trpc.ts` for why the gate is the
 * application's rather than the door's.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OpsApi, opsProcessTrpc } from "@langwatch/ops-contract";

import { OPS_MANAGE, OPS_VIEW, opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsProcessTrpcTransport = defineTrpcRouter(OpsApi, opsProcessTrpc)

  .procedure("getAggregateProcessManagers")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getForAggregate({
      aggregateType: input.aggregateType,
      projectId: input.tenantId,
      aggregateId: input.aggregateId,
    });
  })

  .procedure("requeueDeadOutboxMessages")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.requeueDeadMessages({
      processName: input.processName,
      projectId: input.tenantId,
      processKey: input.processKey,
      messageKeyPrefix: input.messageKeyPrefix,
      requestedBy: actor.id,
    });
  })

  .procedure("listProcessFleet")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getFleetSummary();
  })

  .procedure("listDeadLetters")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getDeadLetters(input);
  })

  .procedure("listDeadLetterCounts")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getDeadLetterCounts();
  })

  .procedure("listProcessInstances")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getInstances(input);
  })

  .procedure("listUpcomingWakes")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getUpcomingWakes(input);
  })

  .procedure("getProcessInstance")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.tryGetInstanceDetail({ ref: input });
  })

  .procedure("listProcessOutbox")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    const { page, pageSize, ...ref } = input;

    return app.getOutbox({ ref, page, pageSize });
  })

  .procedure("listProcessActions")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listRecentActions(input);
  })

  .procedure("processWakeNow")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.wakeNow({ ref: input, actorUserId: actor.id });
  })

  .procedure("processRedriveDeadInstance")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.redriveDeadInstance({ ref: input, actorUserId: actor.id });
  })

  .procedure("processRedriveDeadMessage")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    const { messageId, ...ref } = input;

    return app.redriveDeadMessage({ ref, messageId, actorUserId: actor.id });
  })

  .procedure("processDiscardDeadMessage")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    const { messageId, ...ref } = input;

    return app.discardDeadMessage({ ref, messageId, actorUserId: actor.id });
  })

  .procedure("redriveDeadLetters")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.redriveDeadLetters({ ...input, actorUserId: actor.id });
  })

  .procedure("discardDeadLetters")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.discardDeadLetters({
      ...(input.processName ? { processName: input.processName } : {}),
      actorUserId: actor.id,
    });
  })

  .procedure("listOutboxAttempts")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getOutboxAttempts(input);
  })

  .procedure("processReleaseLapsedLease")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    const { messageId, ...ref } = input;

    return app.releaseLapsedLease({ ref, messageId, actorUserId: actor.id });
  })

  .build();
