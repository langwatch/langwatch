import { describe, expect, it } from "vitest";

import { storedLogRecordOf } from "../trace-log-record-storage.projection.ts";
import { canonicalLogRecordFixture } from "./trace-log-records.fixtures.ts";

const stored = (eventName: string, attributesFlatJson: string) =>
  storedLogRecordOf(canonicalLogRecordFixture({ eventName, attributesFlatJson }));

describe("storedLogRecordOf", () => {
  describe("when the record carries its event name on the EventName column", () => {
    /** @scenario "Codex events are rendered whichever way the agent named them" */
    it("backfills event.name so attribute-keyed readers can recognise the record", () => {
      expect(stored("codex.tool_result", "{}").attributes["event.name"]).toBe("codex.tool_result");
    });

    it("leaves an event.name already in the attributes alone", () => {
      const record = stored("codex.tool_result", '{"event.name":"api_request"}');
      expect(record.attributes["event.name"]).toBe("api_request");
    });

    it("adds no event.name when the column is empty", () => {
      expect(stored("", "{}").attributes["event.name"]).toBeUndefined();
    });
  });
});
