/**
 * The server half of the group-queue and dead-letter procedures.
 *
 * Platform-tier throughout: see `ops-operator.trpc.ts` for why the gate is the
 * application's rather than the door's.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OpsApi, opsQueueTrpc } from "@langwatch/ops-contract";

import { OPS_MANAGE, OPS_VIEW, opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsQueueTrpcTransport = defineTrpcRouter(OpsApi, opsQueueTrpc)

  .procedure("listGroups")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listQueueGroups(input);
  })

  .procedure("getGroupDetail")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getQueueGroup(input);
  })

  .procedure("getGrafanaLinkConfig")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.findGrafanaLinkConfig();
  })

  .procedure("getBlockedSummary")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getBlockedQueueSummary();
  })

  .procedure("getGroupJobs")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listQueueGroupJobs(input);
  })

  .procedure("unblockGroup")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.unblockQueueGroup({ ...input, requestedBy: actor.id });
  })

  .procedure("unblockAll")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.unblockAllQueueGroups({ ...input, requestedBy: actor.id });
  })

  .procedure("drainGroup")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.drainQueueGroup({ ...input, requestedBy: actor.id });
  })

  .procedure("pausePipeline")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.pauseQueuePipeline(input);
  })

  .procedure("unpausePipeline")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.unpauseQueuePipeline(input);
  })

  .procedure("pauseTenant")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.pauseQueueTenant(input);
  })

  .procedure("unpauseTenant")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.unpauseQueueTenant(input);
  })

  .procedure("listPausedTenants")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listPausedQueueTenants(input);
  })

  .procedure("drainTenant")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.drainQueueTenant({ ...input, requestedBy: actor.id });
  })

  .procedure("retryBlocked")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.retryBlockedQueueJob(input);
  })

  .procedure("listProjections")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listPipelineRegistrations();
  })

  .procedure("listDlqGroups")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listQueueDlqGroups(input);
  })

  .procedure("listAllDlqGroups")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listAllQueueDlqGroups();
  })

  .procedure("listPausedKeys")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listPausedQueueKeys(input);
  })

  .procedure("drainAllBlockedPreview")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getQueueDrainPreview(input);
  })

  .procedure("moveToDlq")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.moveQueueGroupToDlq({ ...input, requestedBy: actor.id });
  })

  .procedure("moveAllBlockedToDlq")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.moveAllBlockedQueueGroupsToDlq({ ...input, requestedBy: actor.id });
  })

  .procedure("replayFromDlq")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.replayQueueGroupFromDlq(input);
  })

  .procedure("replayAllFromDlq")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.replayAllQueueGroupsFromDlq(input);
  })

  .procedure("redriveManyFromDlq")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.redriveQueueDlqGroups({ ...input, requestedBy: actor.id });
  })

  .procedure("discardManyFromDlq")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.discardQueueDlqGroups({ ...input, requestedBy: actor.id });
  })

  .procedure("canaryRedrive")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.canaryRedriveQueueDlq(input);
  })

  .procedure("canaryUnblock")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.canaryUnblockQueueGroups(input);
  })

  .build();
