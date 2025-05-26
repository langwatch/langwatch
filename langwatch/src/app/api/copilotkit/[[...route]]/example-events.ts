import { EventType } from "@ag-ui/client";
import { faker } from "@faker-js/faker";

const generateEvents = (threadId: string) => {
  return [
    {
      threadId,
      type: EventType.RUN_STARTED,
    },
    {
      threadId,
      type: EventType.MESSAGES_SNAPSHOT,
      messages: Array.from({ length: 10 }, (value, index) => ({
        content: faker.lorem.sentence(),
        role: index % 2 === 0 ? "user" : "assistant",
      })),
    },
    {
      threadId,
      type: EventType.RUN_FINISHED,
    },
  ];
};

export const exampleEvents = Array.from({ length: 10 }, (_, index) =>
  generateEvents(`thread-${index}`)
).flat();
