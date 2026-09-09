import { describe, expect, it } from "vitest";

import { WrittenApiBootFailure } from "../api-standalone.executable.ts";

describe("WrittenApiBootFailure", () => {
  describe("given a long-running process whose boot throws", () => {
    describe("when it reports the failure", () => {
      const written: string[] = [];
      WrittenApiBootFailure.create({ write: (line) => void written.push(line) }).report(
        new TypeError('Feature API "project" must be implemented by an object.'),
      );

      // @scenario "A process that cannot boot prints one fatal record with its stack"
      it("writes one fatal record with the trace inside it", () => {
        expect(written).toHaveLength(1);
        const record = JSON.parse(written[0] ?? "") as Record<string, unknown>;
        expect(record.level).toBe("fatal");
        expect(record.service).toBe("langwatch-api");
        expect(record.msg).toBe(
          'fatal boot failure: Feature API "project" must be implemented by an object.',
        );
        expect(record.stack).toContain("\n    at ");
      });
    });
  });
});
