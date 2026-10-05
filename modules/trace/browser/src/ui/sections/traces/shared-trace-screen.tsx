import { Link } from "@langwatch/browser-host/link";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useRouter } from "@langwatch/browser-host/use-router";
import { FullLogo } from "@langwatch/design-system/full-logo";
import {
  Alert,
  Box,
  Button,
  Center,
  HStack,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Link2Off } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useSharedTraceRead } from "../../../behavior/reads/use-project-reads.ts";
import { api, type RouterOutputs } from "../../../behavior/trace-api.ts";
import { useTraceDrawer } from "../../../behavior/trace-drawer.ts";
import { TRACE_DRAWER_NAME } from "../../../model/trace-drawer-params.ts";
import { TraceViewerProvider } from "../../elements/explorer/context/trace-viewer-context.tsx";
import { HandledErrorState } from "../errors/index.ts";
import { useTraceQueryArgs } from "../explorer/hooks/use-trace-query-args.ts";
import { TraceDrawerContent } from "../explorer/trace-drawer/trace-drawer-content.tsx";
import { seedSharedTrace } from "./seed-shared-trace.ts";

/** There is no drawer to close on a share page. */
const noop = () => undefined;

/**
 * The span, view and tabs the reader has chosen live in the address like the drawer's
 * own, so a share page names the trace it shows; no drawer registers under that name.
 */
function useSharedTraceAddress(traceId: string): void {
  const { openDrawer } = useDrawer();
  const isOpen = useTraceDrawer((s) => s.isOpen);
  useEffect(() => {
    if (!isOpen) openDrawer(TRACE_DRAWER_NAME, { traceId }, { replace: true });
  }, [isOpen, openDrawer, traceId]);
}

/**
 * The shared trace, rendered with the Trace Explorer surface. The one `sharedTrace.get`
 * payload is seeded into the query cache under the keys the drawer's hooks read, and
 * read-only mode keeps those hooks from firing their own (now protected) reads.
 */
function SharedTraceView({ shared }: { shared: RouterOutputs["sharedTrace"]["get"] }) {
  const utils = api.useUtils();
  const { projectId } = useTraceQueryArgs();
  useState(() => seedSharedTrace({ utils, projectId, shared }));
  useSharedTraceAddress(shared.header.traceId);
  const selectedSpanId = useTraceDrawer((s) => s.selectedSpanId);

  const trace = shared.header;
  const spanTree = shared.spanTree;

  const selectedSpan = useMemo(
    () => (selectedSpanId ? (spanTree.find((s) => s.spanId === selectedSpanId) ?? null) : null),
    [selectedSpanId, spanTree],
  );

  return (
    <Box
      flex={1}
      minHeight={0}
      width="full"
      display="flex"
      flexDirection="column"
      // Never scrolls - every pane inside owns its own scroll viewport.
      overflow="hidden"
      position="relative"
      data-testid="share-page-trace"
    >
      {shared.isSpanDetailTruncated && (
        <Box paddingX={4} paddingTop={3}>
          <Alert.Root status="info" size="sm" width="full">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                This is a large trace. The timeline below is complete, but step-by-step detail is
                only shown for the first {shared.spansFull.length.toLocaleString()} steps.
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
 */
function SharePageSignUpInvitation() {
  return (
    <VStack gap={3} width="full" paddingTop={2} data-testid="share-page-unavailable">
      <Separator />
      <Text fontSize="14px" color="fg.muted" maxWidth="420px">
        LangWatch shows you what your AI agents actually did - every call, its cost, and where it
        went wrong.
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

/**
 * The frame for a page with no session, as main drew it: the wordmark, the
 * sign-in entry and the body in a card. No sidebar, because every link in one
 * needs an account.
 */
function PublicPageFrame({ token, children }: { token: string; children: ReactNode }) {
  const callbackUrl = encodeURIComponent(`/share/${token}`);

  return (
    <Box width="full" minHeight="100vh" background="bg.page">
      <HStack
        width="full"
        height="60px"
        paddingX={4}
        paddingY={3}
        justifyContent="space-between"
        gap={4}
      >
        <Link href="/" display="flex" alignItems="center">
          <FullLogo width={155 * 0.7} height={38 * 0.7} />
        </Link>
        <Link href={`/auth/signin?callbackUrl=${callbackUrl}`}>
          <Button variant="outline" size="sm">
            Sign in
          </Button>
        </Link>
      </HStack>
      <Box
        width="full"
        background="bg.surface"
        borderTopLeftRadius="xl"
        borderTopWidth="1px"
        borderLeftWidth="1px"
        borderColor="border.muted"
        overflow="auto"
        display="flex"
        minHeight="calc(100vh - 60px)"
        maxHeight="calc(100vh - 60px)"
        position="relative"
        data-tour="main-content"
      >
        {children}
      </Box>
    </Box>
  );
}

export default function SharePage() {
  const router = useRouter();
  const token = typeof router.query.id === "string" ? router.query.id : "";

  /**
   * One token-validated read returns the whole read-only payload and consumes exactly
   * one view.
   */
  const shared = useSharedTraceRead({ token });

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
    <PublicPageFrame token={token}>
      <TraceViewerProvider traceId={shared.data.header.traceId} isReadOnly>
        <SharedTraceView shared={shared.data} />
      </TraceViewerProvider>
    </PublicPageFrame>
  );
}
