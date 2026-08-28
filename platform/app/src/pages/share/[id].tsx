import {
  Alert,
  Box,
  Button,
  Center,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Link2Off } from "lucide-react";
import { useMemo } from "react";
import { Link } from "~/components/ui/link";
import { HandledErrorState } from "~/features/errors";
import { TraceDrawerContent } from "~/features/traces-v2/components/TraceDrawer/TraceDrawerContent";
import {
  SharedTraceProvider,
  useSharedTrace,
} from "~/features/traces-v2/context/SharedTraceContext";
import { TraceViewerProvider } from "~/features/traces-v2/context/TraceViewerContext";
import { useDrawerStore } from "@langwatch/trace-web";
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
      selectedSpanId ? (spanTree.find((s) => s.spanId === selectedSpanId) ?? null) : null,
    [selectedSpanId, spanTree],
  );

  if (!trace) {
    return (
      <Center flex={1} padding={8}>
        <Text color="fg.muted">
          This shared trace didn&apos;t load. Refresh the page, or ask whoever shared it
          for a new link.
        </Text>
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
                This is a large trace. The timeline below is complete, but step-by-step
                detail is only shown for the first{" "}
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

/**
 * The way forward from a dead share link.
 *
 * This is the only screen in the product whose visitor is, by definition, not
 * a customer — someone was shown a trace and the link had already gone. They
 * arrived curious and the page has nothing for them, which is a poor use of
 * the one visit we get. So under the explanation there is an invitation:
 * what this thing is, and a way in.
 *
 * Deliberately quiet — a separator, one line, one primary action and a
 * sign-in link for people who already have an account and simply weren't
 * signed in. It sits BELOW the error, never in place of it: the first job of
 * the page is still to say what happened.
 */
function SharePageSignUpInvitation() {
  return (
    <VStack gap={3} width="full" paddingTop={2}>
      <Separator />
      <Text fontSize="14px" color="fg.muted" maxWidth="420px">
        LangWatch shows you what your AI agents actually did — every call, its cost, and
        where it went wrong.
      </Text>
      <VStack gap={2}>
        <Link href="/auth/signup">
          <Button colorPalette="orange">Create a free account</Button>
        </Link>
        <Link href="/auth/signin">
          <Text fontSize="13px" color="fg.muted" textDecoration="underline">
            Already have an account?
          </Text>
        </Link>
      </VStack>
    </VStack>
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
    // Share errors are safe for anonymous visitors and include remediation.
    return (
      <HandledErrorState
        error={shared.error}
        fallbackTitle="This share link isn't available"
        icon={<Link2Off size={44} strokeWidth={1.5} />}
      >
        <SharePageSignUpInvitation />
      </HandledErrorState>
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
