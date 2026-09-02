/**
 * What this package's suites mount the topic-clustering screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what the screen asked the
 * application to say, which is exactly the surface the real adapter answers.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  TopicHostPort,
  TopicHostProvider,
  type TopicFailureNotice,
  type TopicHostProject,
  type TopicSuccessNotice,
} from "./model/topic-host";

export class FakeTopicHost extends TopicHostPort {
  readonly successes: TopicSuccessNotice[] = [];
  readonly failures: TopicFailureNotice[] = [];

  constructor(private readonly options: { project?: TopicHostProject | null } = {}) {
    super();
  }

  project(): TopicHostProject | undefined {
    if (this.options.project === null) return void 0;
    return this.options.project ?? { id: "project-1" };
  }

  succeeded(notice: TopicSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: TopicFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithTopicHost(
  element: ReactElement,
  host: FakeTopicHost = new FakeTopicHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <TopicHostProvider value={host}>{element}</TopicHostProvider>
      </ChakraProvider>,
    ),
  };
}
