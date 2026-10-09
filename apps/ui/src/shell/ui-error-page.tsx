/**
 * What the application shows when it threw: the sign-in doors' branded card, never a white page.
 * Spec: specs/frontend/app-error-page.feature
 */

import { resolveUiFailureCopy } from "@langwatch/browser-host/feedback";
import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { Button, Center, Collapsible, HStack, Text } from "@langwatch/design-system/primitives";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";
import { nowInstant } from "@langwatch/time";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { useLocation, useRouteError } from "react-router";

type UiErrorProps = { error: unknown; isDevelopment: boolean };

/** The whole viewport: the branded ground with the error card on it. */
export function UiErrorPage(props: UiErrorProps) {
  return (
    <BrandedCardPage>
      <UiErrorCard {...props} />
    </BrandedCardPage>
  );
}

/**
 * A screen that threw, inside the chrome: the sidebar and top bar stay so the reader can
 * navigate away, and the next address resets it.
 */
export function UiScreenErrorBoundary({
  isDevelopment,
  children,
}: {
  isDevelopment: boolean;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary
      resetKeys={[pathname]}
      fallbackRender={({ error }) => (
        <Center minHeight="60vh" padding={8}>
          <UiErrorCard error={error} isDevelopment={isDevelopment} />
        </Center>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/** The words come from the presentation registry; an unknown error's message is never shown. */
function UiErrorCard({ error, isDevelopment }: UiErrorProps) {
  const copy = resolveUiFailureCopy({ error, fallbackTitle: "Something went wrong" });
  const [occurredAt] = useState(() => nowInstant().toString());
  const clipboard = useCopyToClipboard();
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);

  useEffect(() => {
    console.error("[UiErrorPage]", error);
  }, [error]);

  return (
    <BrandedCard
      title={copy.title}
      intro={copy.description}
      cardAttributes={{ "data-testid": "app-error-page" }}
      footer={
        copy.traceId ? (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" userSelect="all">
            Trace id: {copy.traceId}
          </Text>
        ) : null
      }
    >
      <HStack justify="center" gap={3}>
        <Button colorPalette="orange" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button variant="outline" asChild>
          <a href="/">Go home</a>
        </Button>
      </HStack>
      <Collapsible.Root width="full" minWidth={0}>
        <HStack justify={isDevelopment ? "space-between" : "center"} gap={2}>
          {isDevelopment ? (
            <Collapsible.Trigger asChild>
              <Button size="xs" variant="ghost" color="fg.muted">
                <ChevronRight size={12} />
                Error details
              </Button>
            </Collapsible.Trigger>
          ) : null}
          {typeof navigator !== "undefined" && navigator.clipboard ? (
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              onClick={() =>
                clipboard.copy(
                  uiErrorReport({
                    error,
                    traceId: copy.traceId,
                    url: window.location.href,
                    occurredAt,
                  }),
                )
              }
            >
              {clipboard.copied ? <Check size={12} /> : <Copy size={12} />}
              {clipboard.copied ? "Copied" : "Copy error details"}
            </Button>
          ) : null}
        </HStack>
        {isDevelopment ? (
          <Collapsible.Content>
            <Text
              as="pre"
              marginTop={2}
              padding={3}
              borderRadius="md"
              backgroundColor="bg.subtle"
              fontSize="xs"
              fontFamily="mono"
              color="fg.muted"
              textAlign="left"
              maxHeight="240px"
              overflow="auto"
              whiteSpace="pre-wrap"
              overflowWrap="anywhere"
              data-testid="app-error-stack"
            >
              {stack}
            </Text>
          </Collapsible.Content>
        ) : null}
      </Collapsible.Root>
    </BrandedCard>
  );
}

/** What a reader pastes to support: the error, where and when it happened, and its trace id. */
export function uiErrorReport({
  error,
  traceId,
  url,
  occurredAt,
}: {
  error: unknown;
  traceId: string | undefined;
  url: string;
  occurredAt: string;
}): string {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return [
    `Error: ${message}`,
    ...(traceId ? [`Trace id: ${traceId}`] : []),
    `URL: ${url}`,
    `Time: ${occurredAt}`,
    ...(stack ? ["", stack] : []),
  ].join("\n");
}

export type UiErrorPages = {
  /** Above every provider, so it brings the design system nothing above it supplied. */
  application: ComponentType<FallbackProps>;
  /** The router's errorElement: loader and render throws below the root route. */
  route: ComponentType;
  /** The root layout's boundary, which the module host mounts and every page sit inside. */
  page: ComponentType<FallbackProps>;
};

/** The three positions a throw can be caught at, each drawing the one page. */
export function uiErrorPages({ isDevelopment }: { isDevelopment: boolean }): UiErrorPages {
  return {
    application: function UiApplicationError({ error }: FallbackProps) {
      return (
        <DesignSystemProvider>
          <UiErrorPage error={error} isDevelopment={isDevelopment} />
        </DesignSystemProvider>
      );
    },
    route: function UiRouteError() {
      return <UiErrorPage error={useRouteError()} isDevelopment={isDevelopment} />;
    },
    page: function UiPageError({ error }: FallbackProps) {
      return <UiErrorPage error={error} isDevelopment={isDevelopment} />;
    },
  };
}
