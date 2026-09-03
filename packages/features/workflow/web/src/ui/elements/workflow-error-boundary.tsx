/**
 * A crash inside the create dialog's body, kept inside the dialog.
 *
 * `platform/app`'s `IsolatedErrorBoundary` is what the create dialog wrapped
 * its content in, and it is `react-error-boundary` plus a fallback panel plus
 * `explainAnyError`, which resolves copy from the application's code-keyed
 * presentation registry. None of that travels: the registry is the
 * application's, and adding a runtime dependency to render one panel is not
 * what the boundary is for.
 *
 * WHAT THE BOUNDARY IS FOR is that a render-time crash in a template card or
 * an emoji picker must not take the page down with it. That property is a
 * fourteen-line class component, and it is stated here rather than imported.
 * The words are the fallback's own, not a code's, because a render crash is by
 * definition something we could not name.
 */

import { Alert } from "@chakra-ui/react";
import { Component, type ErrorInfo, type ReactNode } from "react";

export class WorkflowErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Default-log so dev tooling and any session-replay scraper catch it even
    // though nothing else here reports it.
    // eslint-disable-next-line no-console
    console.error("[WorkflowErrorBoundary]", error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Something went wrong</Alert.Title>
          <Alert.Description>
            This part of the dialog could not be shown. Close it and try again.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }
}
