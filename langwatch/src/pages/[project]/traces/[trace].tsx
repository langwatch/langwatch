import {
  Alert,
  AlertIcon,
  Box,
  HStack,
  Heading,
  Skeleton,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import type { PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { getTotalTokensDisplay } from "../../../mappers/trace";
import { api } from "../../../utils/api";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { LoadingScreen } from "../../../components/LoadingScreen";
import ErrorPage from "next/error";
import { isNotFound } from "../../../utils/trpcError";
import { formatMilliseconds } from "../../../utils/formatMilliseconds";
import { HelpCircle } from "react-feather";

export default function Trace() {
  const router = useRouter();
  const traceId =
    typeof router.query.trace === "string" ? router.query.trace : undefined;
  const { project } = useOrganizationTeamProject();
  const trace = api.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId: traceId ?? "" },
    { enabled: !!project && !!traceId }
  );

  const SummaryItem = ({
    label,
    tooltip,
    children,
  }: PropsWithChildren<{ label: string; tooltip?: string }>) => {
    return (
      <VStack
        borderRightWidth="1px"
        borderRightColor="gray.300"
        alignItems="flex-start"
        paddingY={6}
        paddingRight={4}
        _last={{ border: "none" }}
      >
        <HStack>
          <b>{label}</b>
          {tooltip && (
            <Tooltip label={tooltip}>
              <HelpCircle width="14px" />
            </Tooltip>
          )}
        </HStack>
        <Box color="gray.700">{children}</Box>
      </VStack>
    );
  };

  if (isNotFound(trace.error)) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <DashboardLayout backgroundColor="white">
      <Box
        maxWidth="1200"
        paddingY={6}
        paddingX={12}
        alignSelf="flex-start"
        width="full"
      >
        <VStack spacing={6} alignItems="flex-start" width="full">
          <Heading as="h1">Trace Detail</Heading>
          {trace.data ? (
            <HStack
              spacing={4}
              borderTopWidth={1}
              borderBottomWidth={1}
              borderColor="gray.300"
            >
              <SummaryItem label="ID">
                <Text as="span" fontFamily="mono">
                  {traceId}
                </Text>
              </SummaryItem>
              {(!!trace.data.metrics.completion_tokens ||
                !!trace.data.metrics.prompt_tokens) && (
                <SummaryItem
                  label="Total Tokens"
                  tooltip={
                    trace.data.metrics.tokens_estimated
                      ? "Token count is calculated by LangWatch when not available from the trace data"
                      : "How many tokens were processed combining both input and output"
                  }
                >
                  {getTotalTokensDisplay(trace.data)}
                </SummaryItem>
              )}
              {trace.data.metrics.first_token_ms && (
                <SummaryItem
                  label="Time to First Token"
                  tooltip="How long did it took for the first token of the last span to arrive, that is, the smallest delay between request and the first output token to appear for the user"
                >
                  {formatMilliseconds(trace.data.metrics.first_token_ms)}
                </SummaryItem>
              )}
              {trace.data.metrics.total_time_ms && (
                <SummaryItem
                  label="Total Completion Time"
                  tooltip="How long it took for completion to be fully done"
                >
                  {formatMilliseconds(trace.data.metrics.total_time_ms)}
                </SummaryItem>
              )}
            </HStack>
          ) : trace.isError ? (
            <Alert status="error">
              <AlertIcon />
              An error has occurred trying to load this trace
            </Alert>
          ) : (
            <VStack gap={4} width="full">
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
            </VStack>
          )}
        </VStack>
      </Box>
    </DashboardLayout>
  );
}
