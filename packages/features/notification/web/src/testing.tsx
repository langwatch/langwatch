/**
 * What this package's suites mount the email-suppressions screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what the screen asked the
 * application to say and answers the one grant the page reads, which is exactly
 * the surface the real adapter answers.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  NotificationHostPort,
  NotificationHostProvider,
  type NotificationFailureNotice,
  type NotificationHostProject,
  type NotificationSuccessNotice,
} from "./model/notification-host";

export class FakeNotificationHost extends NotificationHostPort {
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
    return (this.options.permissions ?? ["triggers:view", "triggers:manage"]).includes(
      permission,
    );
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
