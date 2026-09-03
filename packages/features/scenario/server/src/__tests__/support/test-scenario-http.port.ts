import {
  ScenarioHttpPort,
  type ScenarioHttpResponse,
  SerializedHttpAgentAdapter,
} from "../../index";
import { vi } from "vitest";

type ScenarioHttpRequest = Parameters<ScenarioHttpPort["fetch"]>[0];
type ScenarioHttpAdapterOptions = ConstructorParameters<typeof SerializedHttpAgentAdapter>[0];

export const mockScenarioHttpFetch = vi.fn(
  async (_url: string, _init: ScenarioHttpRequest["init"]): Promise<ScenarioHttpResponse> => {
    throw new Error("Scenario HTTP response was not configured");
  },
);

class TestScenarioHttpPort extends ScenarioHttpPort {
  fetch(input: ScenarioHttpRequest): Promise<ScenarioHttpResponse> {
    return mockScenarioHttpFetch(input.url, input.init);
  }
}

class NativeScenarioHttpPort extends ScenarioHttpPort {
  fetch(input: ScenarioHttpRequest): Promise<ScenarioHttpResponse> {
    return fetch(input.url, input.init);
  }
}

export function createMockHttpAgentAdapter(
  options: Omit<ScenarioHttpAdapterOptions, "httpPort">,
): SerializedHttpAgentAdapter {
  return new SerializedHttpAgentAdapter({
    ...options,
    httpPort: new TestScenarioHttpPort(),
  });
}

export function createNativeHttpAgentAdapter(
  options: Omit<ScenarioHttpAdapterOptions, "httpPort">,
): SerializedHttpAgentAdapter {
  return new SerializedHttpAgentAdapter({
    ...options,
    httpPort: new NativeScenarioHttpPort(),
  });
}
