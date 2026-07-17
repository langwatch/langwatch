import {
  clusterTopicsForProject,
  type ClusteringPageOutcome,
} from "../server/topicClustering/topicClustering";

export default async function execute(projectId: string) {
  let searchAfter: ClusteringPageOutcome["nextSearchAfter"];
  do {
    const outcome = await clusterTopicsForProject(projectId, searchAfter);
    console.log(
      `mode=${outcome.mode} traces=${outcome.tracesProcessed}` +
        (outcome.skippedReason ? ` skipped=${outcome.skippedReason}` : ""),
    );
    searchAfter = outcome.nextSearchAfter;
  } while (searchAfter);
}
