/**
 * What a routed page shows instead of itself.
 */

import type { ResolvedUiFailureCopy } from "@langwatch/browser-host/feedback";
import {
  Button,
  Center,
  Heading,
  Spinner,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { ErrorActions } from "@langwatch/error-views";
import { RestrictedAccess } from "@langwatch/design-system/restricted-access";

/** While the flags a page is behind have not answered. */
export function UiPageLoading() {
  return (
    <Center minHeight="60vh" padding={8}>
      <Spinner size="lg" color="fg.muted" />
    </Center>
  );
}

/** When a flag a page is behind is off: the address exists, this page does not. */
export function UiPageNotFound() {
  return (
    <Center minHeight="60vh" padding={8}>
      <Stack gap={3} align="center" maxWidth="480px" textAlign="center">
        <Heading size="lg">This page is not here</Heading>
        <Text color="fg.muted">
          The address is wrong, or this part of LangWatch is not switched on for your organization.
        </Text>
      </Stack>
    </Center>
  );
}

/** When the page exists and the viewer is missing the grant it needs. */
export function UiPageForbidden({ permission }: { permission: string }) {
  return <RestrictedAccess permission={permission} />;
}

/**
 * When a read the page is built on refused. The words come from the code-keyed
 * presentation registry, resolved by `resolveUiFailureCopy`; the trace id is
 * the only technical detail shown, and is what a reader quotes to support.
 */
export function UiPageFailure({
  copy,
  retry,
}: {
  copy: ResolvedUiFailureCopy;
  /** A "Try again" for a failure a reload can clear: a transient fault, or a lapsed session. */
  retry?: { onRetry: () => void; testId: string };
}) {
  return (
    <Center minHeight="60vh" padding={8}>
      <Stack gap={3} align="center" maxWidth="480px" textAlign="center" role="alert">
        <Heading size="lg">{copy.title}</Heading>
        {copy.description && <Text color="fg.muted">{copy.description}</Text>}
        {retry && (
          <Button colorPalette="orange" onClick={retry.onRetry} data-testid={retry.testId}>
            Try again
          </Button>
        )}
        <ErrorActions
          {...(copy.docsUrl ? { docsUrl: copy.docsUrl } : {})}
          {...(copy.traceId ? { traceId: copy.traceId } : {})}
        />
      </Stack>
    </Center>
  );
}
