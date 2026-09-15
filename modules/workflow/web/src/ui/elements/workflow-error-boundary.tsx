/**
 * Keeps render crashes in template cards and emoji pickers from taking the page down.
 * Can't use IsolatedErrorBoundary (would pull in the app's registry).
 * Hardcoded text because render crashes can't be named.
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
