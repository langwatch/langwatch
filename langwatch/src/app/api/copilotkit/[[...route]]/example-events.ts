import { EventType } from "@ag-ui/client";
import { faker } from "@faker-js/faker";

const generateEvents = (threadId: string, success: boolean) => {
  const messages = Array.from({ length: 10 }, (value, index) => ({
    content: faker.lorem.sentence(),
    role: index % 2 === 0 ? "user" : "assistant",
  }));

  return [
    generateStartScenarioEvent(threadId),
    {
      threadId,
      type: EventType.RUN_STARTED,
      timestamp: new Date().toISOString(),
    },
    {
      threadId,
      type: EventType.MESSAGES_SNAPSHOT,
      messages,
      timestamp: new Date().toISOString(),
    },
    {
      threadId,
      type: EventType.RUN_FINISHED,
      timestamp: new Date().toISOString(),
    },
    generateEndScenarioEvent(threadId, success, messages),
  ];
};

const generateStartScenarioEvent = (threadId: string) => {
  return {
    threadId,
    type: EventType.CUSTOM,
    name: "SCENARIO_RUN_STARTED",
    timestamp: new Date().toISOString(),
    value: {
      status: "success",
    },
  };
};

const generateEndScenarioEvent = (
  threadId: string,
  success: boolean,
  messages: { content: string; role: string }[]
) => {
  return {
    threadId,
    type: EventType.CUSTOM,
    name: "SCENARIO_RUN_FINISHED",
    timestamp: new Date().toISOString(),
    value: {
      status: success ? "success" : "failure",
      messages,
    },
  };
};

export const exampleEvents = Array.from({ length: 10 }, (_, index) =>
  generateEvents(`thread-${index}`, index % 2 === 0)
).flat();
