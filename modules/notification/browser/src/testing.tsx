/**
 * Test fixture for mounting the email-suppressions screen. Implements the
 * host port and records screen requests.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  NotificationHostApi,
  NotificationHostProvider,
  type NotificationFailureNotice,
  type NotificationHostProject,
  type NotificationSuccessNotice,
} from "./model/notification-host.ts";

export class FakeNotificationHost extends NotificationHostApi {
  readonly successes: NotificationSuccessNotice[] = [];
  readonly failures: NotificationFailureNotice[] = [];

  constructor(
    private readonly options: {
      project?: NotificationHostProject | null;
      permissions?: readonly string[];
    } = {},
  ) {
    super();
  }

  project(): NotificationHostProject | undefined {
    if (this.options.project === null) return void 0;
    return this.options.project ?? { id: "project-1" };
  }

  hasPermission(permission: string): boolean {
    return (this.options.permissions ?? ["triggers:view", "triggers:manage"]).includes(permission);
  }

  succeeded(notice: NotificationSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: NotificationFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithNotificationHost(
  element: ReactElement,
  host: FakeNotificationHost = new FakeNotificationHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <NotificationHostProvider value={host}>{element}</NotificationHostProvider>
      </ChakraProvider>,
    ),
  };
}
