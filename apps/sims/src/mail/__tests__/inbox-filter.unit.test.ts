import { describe, expect, it } from "vitest";

import { filterMessages, recipientCounts } from "../inbox-filter.ts";
import { summarySchema, type Summary } from "../mail-api.ts";

const message = ({ id, to, subject }: { id: string; to: string[]; subject: string }): Summary =>
  summarySchema.parse({
    id,
    from: "sender@example.test",
    to,
    subject,
    receivedAt: "2026-09-28T10:00:00Z",
    sizeBytes: 10,
  });

const messages = [
  message({ id: "1", to: ["Alex@example.test", "alex@example.test"], subject: "Welcome" }),
  message({ id: "2", to: ["sam@example.test"], subject: "Invite" }),
];

describe("recipientCounts", () => {
  it("counts each message once per address, case-insensitively", () => {
    expect(recipientCounts({ messages })).toEqual([
      { address: "alex@example.test", count: 1 },
      { address: "sam@example.test", count: 1 },
    ]);
  });
});

describe("filterMessages", () => {
  it("searches subject, sender and recipients", () => {
    expect(filterMessages({ messages, query: "invite", recipient: "" }).map((m) => m.id)).toEqual([
      "2",
    ]);
  });

  it("narrows to one recipient", () => {
    expect(
      filterMessages({ messages, query: "", recipient: "alex@example.test" }).map((m) => m.id),
    ).toEqual(["1"]);
  });
});
