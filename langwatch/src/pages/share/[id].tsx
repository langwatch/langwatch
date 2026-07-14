import { Box, Center, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { TraceDrawerContent } from "~/features/traces-v2/components/TraceDrawer/TraceDrawerContent";
import { TraceViewerProvider } from "~/features/traces-v2/context/TraceViewerContext";
import { useSpanTree } from "~/features/traces-v2/hooks/useSpanTree";
import { useTraceHeader } from "~/features/traces-v2/hooks/useTraceHeader";
import { useDrawerStore } from "~/features/traces-v2/stores/drawerStore";
import ErrorPage from "~/utils/compat/next-error";
import { useRouter } from "~/utils/compat/next-router";
import { DashboardLayout } from "../../components/DashboardLayout";
import { api } from "../../utils/api";

/** There is no drawer to close on a share page. */
const noop = () => undefined;

/**
 * The shared trace, rendered with the new Trace Explorer surface. Must be
 * mounted inside `TraceViewerProvider` — the per-trace query hooks read their
 * `traceId` from it rather than from the drawer store, so the app-wide
 * `GlobalTraceV2DrawerMount` stays inert and no drawer opens over the page.
 */
function SharedTraceView({ traceId }: { traceId: string }) {
  const headerQuery = useTraceHeader();
  const spanTreeQuery = useSpanTree();
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);

  // `useTraceHeader` keeps previous data across trace switches, so guard by id.
  const trace =
    headerQuery.data && headerQuery.data.traceId === traceId
      ? headerQuery.data
      : null;
  const spanTree = spanTreeQuery.data && trace ? spanTreeQuery.data : [];
  const isLoading = !trace && !headerQuery.error;

  const selectedSpan = useMemo(
    () =>
      selectedSpanId
        ? (spanTree.find((s) => s.spanId === selectedSpanId) ?? null)
        : null,
    [selectedSpanId, spanTree],
  );

  if (headerQuery.error) {
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
      // Never scrolls — every pane inside owns its own scroll viewport, and
      // this is the positioning context for the trace-switch overlay.
      overflow="hidden"
      position="relative"
    >
      <TraceDrawerContent
        traceId={traceId}
        trace={trace}
        spanTree={spanTree}
        selectedSpan={selectedSpan}
        isLoading={isLoading}
        isSpansLoading={spanTreeQuery.isLoading}
        onClose={noop}
        readOnly
      />
    </Box>
  );
}

export default function SharePage() {
  const router = useRouter();
  const token = typeof router.query.id === "string" ? router.query.id : "";
  const resolveShare = api.share.resolve.useMutation();

  /**
   * Exchange the share token for a scoped viewing grant (httpOnly cookie) before
   * rendering. The trace reads below authorize on that grant, so they must not
   * fire until it is set.
   *
   * One resolve == one view, so this must fire exactly once per page load. It is
   * driven through React Query rather than a `useEffect` + ref: the query key
   * dedupes concurrent callers onto a single in-flight request and caches the
   * result across remounts. An effect guard could not do that — a remount reset
   * the ref, firing a second `resolve` that raced the first before its
   * Set-Cookie landed, burning two views on a single load. See ADR-039.
   */
  const resolve = useQuery({
    queryKey: ["share", "resolve", token],
    queryFn: () => resolveShare.mutateAsync({ token }),
    enabled: !!token,
    staleTime: Infinity,
    cacheTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (resolve.isError) {
    return (
      <Center height="100vh" padding={8}>
        <Text color="fg.muted">
          {resolve.error instanceof Error
            ? resolve.error.message
            : "This share link is not available."}
        </Text>
      </Center>
    );
  }

  if (!resolve.isSuccess) {
    // In-flight token exchange: show loading state
    if (resolve.isLoading) {
      return (
        <Center height="100vh" padding={8}>
          <Text color="fg.muted">Loading share...</Text>
        </Center>
      );
    }
    // Not started or other non-success state
    return null;
  }

  if (resolve.data.resourceType !== "TRACE") {
    // Only trace shares render for now.
    return <ErrorPage statusCode={404} />;
  }

  return (
    <DashboardLayout publicPage>
      <TraceViewerProvider
        traceId={resolve.data.resourceId}
        readOnly
        sharedThreadId={resolve.data.threadId}
      >
        <SharedTraceView traceId={resolve.data.resourceId} />
      </TraceViewerProvider>
    </DashboardLayout>
  );
}
