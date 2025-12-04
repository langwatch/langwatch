import { describe, it } from "vitest";

describe("TracesService", () => {
  describe("checkLimit", () => {
    describe("when organizationId is not found", () => {
      it.todo("throws an error");
    });

    describe("when count >= maxMessagesPerMonth", () => {
      it.todo("returns exceeded: true with message");
    });

    describe("when count < maxMessagesPerMonth", () => {
      it.todo("returns exceeded: false");
    });
  });

  describe("getCurrentMonthCount", () => {
    describe("when organization has no projects", () => {
      it.todo("returns 0 without querying ES");
    });

    describe("when organization has projects", () => {
      it.todo("queries ES with all project IDs");
    });
  });
});

