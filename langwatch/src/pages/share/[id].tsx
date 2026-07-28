import { Alert, Box, Center, Spinner, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import { TraceDrawerContent } from "~/features/traces-v2/components/TraceDrawer/TraceDrawerContent";
import {
  SharedTraceProvider,
  useSharedTrace,
} from "~/features/traces-v2/context/SharedTraceContext";
import { TraceViewerProvider } from "~/features/traces-v2/context/TraceViewerContext";
import { useDrawerStore } from "~/features/traces-v2/stores/drawerStore";
import { useRouter } from "~/utils/compat/next-router";
import { DashboardLayout } from "../../components/DashboardLayout";
import { api } from "../../utils/api";

/** There is no drawer to close on a share page. */
const noop = () => undefined;

/**
 * The shared trace, rendered with the Trace Explorer surface. All per-trace
 * data comes from the one `sharedTrace.get` payload in context — the drawer's
 * internal hooks read their slice from there rather than firing their own
 * (now protected) reads. See ADR-057.
 */
function SharedTraceView() {
  const shared = useSharedTrace();
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);

  const trace = shared?.header ?? null;
  const spanTree = shared?.spanTree ?? [];

  const selectedSpan = useMemo(
    () =>
      selectedSpanId
        ? (spanTree.find((s) => s.spanId === selectedSpanId) ?? null)
        : null,
    [selectedSpanId, spanTree],
  );

  if (!trace) {
    return (
      <Center flex={1} padding={8}>
        <Text color="fg.muted">This trace could not be loaded.</Text>
      </Center>
    );
  }

  return (
    <Box
      flex={1}
      minHeight={0}
      width="full"
      display="flex"
      flexDirection="column"
      // Never scrolls — every pane inside owns its own scroll viewport.
      overflow="hidden"
      position="relative"
    >
      {shared?.isSpanDetailTruncated && (
        <Box paddingX={4} paddingTop={3}>
          <Alert.Root status="info" size="sm" variant="subtle" width="full">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description fontSize="sm">
                This is a large trace. The timeline below is complete, but
                step-by-step detail is only shown for the first{" "}
                {shared.spansFull.length.toLocaleString()} steps.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        </Box>
      )}
      <TraceDrawerContent
        traceId={trace.traceId}
        trace={trace}
        spanTree={spanTree}
        selectedSpan={selectedSpan}
        isLoading={false}
        isSpansLoading={false}
        onClose={noop}
        readOnly
      />
    </Box>
  );
}

export default function SharePage() {
  const router = useRouter();
  const token = typeof router.query.id === "string" ? router.query.id : "";

  /**
   * One token-validated read returns the whole read-only payload and consumes
   * exactly one view. Driven through the tRPC query so its key dedupes the
   * page, the layout chrome and every drawer hook onto a SINGLE request — a
   * page load never burns more than one view. See ADR-057.
   */
  const shared = api.sharedTrace.get.useQuery(
    { token },
    {
      enabled: !!token,
      staleTime: Infinity,
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

  if (shared.isError) {
    return (
      <Center height="100vh" padding={8}>
        <Text color="fg.muted">
          {shared.error instanceof Error
            ? shared.error.message
            : "This share link is not available."}
        </Text>
      </Center>
    );
  }

  // Pending: the token isn't in router.query yet, or the single share read is
  // in flight. Show a spinner rather than a blank page for that round trip.
  if (!shared.isSuccess) {
    return (
      <Center height="100vh" padding={8}>
        <Spinner size="lg" />
      </Center>
    );
  }

  return (
    <DashboardLayout publicPage>
      <SharedTraceProvider value={shared.data}>
        <TraceViewerProvider traceId={shared.data.header.traceId} isReadOnly>
          <SharedTraceView />
        </TraceViewerProvider>
      </SharedTraceProvider>
    </DashboardLayout>
  );
}
