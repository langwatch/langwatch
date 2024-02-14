import { clusterTopicsForProject } from "../server/topicClustering/topicClustering";

export default async function execute(projectId: string) {
  await clusterTopicsForProject(projectId, undefined, false);
}