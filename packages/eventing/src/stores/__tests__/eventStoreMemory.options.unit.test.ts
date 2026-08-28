import { describe, expect, it } from "vitest";
import { EventSourcing } from "../../eventSourcing";
import { EventStoreMemory } from "../eventStoreMemory";

describe("EventStoreMemory runtime usage policy", () => {
  it("fails closed when no non-production fallback is explicitly configured", () => {
    const eventSourcing = new EventSourcing();

    expect(() => eventSourcing.getEventStore()).toThrow(
      "Tests and local development must explicitly inject EventStoreMemory",
    );
  });

  it("allows explicit non-production factory opt-in", () => {
    expect(() => EventStoreMemory.createForTesting()).not.toThrow();
    expect(() => EventStoreMemory.createForLocalDevelopment()).not.toThrow();
  });
});
