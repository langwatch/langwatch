import { vi } from "vitest";

import {
  type ScenarioHttpResponse,
  HttpSerializedHttpAgentChannel,
  type ScenarioHttp,
} from "../../index.ts";

type ScenarioHttpRequest = Parameters<ScenarioHttp["fetch"]>[0];
type ScenarioHttpAdapterOptions = ConstructorParameters<typeof HttpSerializedHttpAgentChannel>[0];

export const mockScenarioHttpFetch = vi.fn(
  async (_url: string, _init: ScenarioHttpRequest["init"]): Promise<ScenarioHttpResponse> => {
    throw new Error("Scenario HTTP response was not configured");
  },
);

class TestScenarioHttp implements ScenarioHttp {
  fetch(input: ScenarioHttpRequest): Promise<ScenarioHttpResponse> {
    return mockScenarioHttpFetch(input.url, input.init);
  }
}

class NativeScenarioHttp implements ScenarioHttp {
  fetch(input: ScenarioHttpRequest): Promise<ScenarioHttpResponse> {
    return fetch(input.url, input.init);
  }
}

export function createMockHttpAgentAdapter(
  options: Omit<ScenarioHttpAdapterOptions, "httpPort">,
): HttpSerializedHttpAgentChannel {
  return new HttpSerializedHttpAgentChannel({
    ...options,
    httpPort: new TestScenarioHttp(),
  });
}

export function createNativeHttpAgentAdapter(
  options: Omit<ScenarioHttpAdapterOptions, "httpPort">,
): HttpSerializedHttpAgentChannel {
  return new HttpSerializedHttpAgentChannel({
    ...options,
    httpPort: new NativeScenarioHttp(),
  });
}
