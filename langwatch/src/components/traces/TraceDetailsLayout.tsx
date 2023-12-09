import { HStack, Heading, Text, VStack } from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { type PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { isNotFound } from "../../utils/trpcError";

export function useTraceFromUrl() {
  const router = useRouter();
  const traceId =
    typeof router.query.trace === "string" ? router.query.trace : undefined;
  const { project } = useOrganizationTeamProject();
  const trace = api.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId: traceId ?? "" },
    { enabled: !!project && !!traceId, refetchOnWindowFocus: false }
  );

  return { traceId, trace };
}

export function TraceDetailsLayout({ children }: PropsWithChildren) {
  const { traceId, trace } = useTraceFromUrl();

  if (isNotFound(trace.error)) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <DashboardLayout backgroundColor="white">
      <VStack
        maxWidth="1600"
        paddingY={6}
        paddingX={12}
        alignSelf="flex-start"
        alignItems="flex-start"
        width="full"
        spacing={10}
      >
        <VStack spacing={6} alignItems="flex-start" width="full">
          <HStack gap={5}>
            <Heading as="h1">Message Details</Heading>
            <Text color="gray.400" fontFamily="mono">
              (ID: {traceId})
            </Text>
          </HStack>
          {children}
        </VStack>
      </VStack>
    </DashboardLayout>
  );
}
