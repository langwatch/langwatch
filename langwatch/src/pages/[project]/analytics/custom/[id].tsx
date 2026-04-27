import { Box, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "~/utils/compat/next-router";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import AnalyticsCustomGraph, { type CustomGraphFormData } from "./index";

export default function EditCustomAnalyticsPage() {
  const router = useRouter();
  const graphId = router.query.id as string;

  const { project } = useOrganizationTeamProject();

  const graphData = api.graphs.getById.useQuery(
    {
      projectId: project?.id ?? "",
      id: graphId ?? "",
    },
    { enabled: !!project?.id && !!graphId, retry: false },
  );

  const graph = graphData.data?.graph;
  const name = graphData.data?.name;
  const rawAlert = graphData.data?.alert;
  const alert: CustomGraphFormData["alert"] | undefined =
    rawAlert != null &&
    rawAlert.type != null &&
    (rawAlert.action === "SEND_EMAIL" ||
      rawAlert.action === "SEND_SLACK_MESSAGE")
      ? (rawAlert as unknown as CustomGraphFormData["alert"])
      : undefined;

  if (graphData.error) {
    return (
      <VStack align="start" p={8} gap={2}>
        <Text fontSize="xl" fontWeight="bold">
          Graph not found
        </Text>
        <Text color="gray.600">
          The graph you are looking for does not exist or you do not have
          access to it.
        </Text>
      </VStack>
    );
  }

  if (graphData.isLoading) {
    return <Box p={8}>Loading…</Box>;
  }

  return graph ? (
    <AnalyticsCustomGraph
      customId={graphId}
      graph={graph as CustomGraphInput}
      name={name ?? ""}
      filters={graphData.data?.filters}
      alert={alert}
    />
  ) : null;
}
