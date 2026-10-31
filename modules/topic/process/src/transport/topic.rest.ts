/** Public management endpoint for starting a project-scoped topic-clustering run. */
import { AuthenticatedActorRequiredError } from "@langwatch/api";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRequestContext,
  type RestDoorCredential,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { TopicApi, topicClusteringTriggerResultSchema } from "@langwatch/topic-contract";
import { z } from "zod";

const emptyInputSchema = z.object({}).strict();

export function createTopicClusteringRest(): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<TopicApi, RestDoorCredential, typeof projectRequestContext>;
}> {
  return defineRestRouter(TopicApi)
    .withNamespace("topics")
    .withVersion(MANAGEMENT_API_VERSION)
    .post("/clustering/run", "postApiTopicsClusteringRun")
    .keepsRecords()
    .withAudit("topics.clustering.run")
    .withInput(emptyInputSchema)
    .withPermission("project:update")
    .withOutput(topicClusteringTriggerResultSchema)
    .withDocs({
      tags: ["Topics"],
      description: "Start topic clustering for the project unless a run is already in progress",
    })
    .withMiddlewareContext(projectRequestContext)
    .handle(({ app, actor, scope }) => {
      if (actor === null) throw new AuthenticatedActorRequiredError();
      return app.triggerTopicClustering({ projectId: scope.id, by: { id: actor.id } });
    })
    .build();
}
