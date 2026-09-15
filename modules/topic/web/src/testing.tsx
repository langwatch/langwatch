// Topic-clustering screen's test mount point: host port is an abstract class so a test
// constructs one and records what the screen asked the application to say.

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  TopicHostApi,
  TopicHostProvider,
  type TopicFailureNotice,
  type TopicHostProject,
  type TopicSuccessNotice,
} from "./model/topic-host.ts";

export class FakeTopicHost extends TopicHostApi {
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
