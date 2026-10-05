/**
 * A public API save separates the delivery configuration a channel owns from
 * the rule the automation fires by, and it reads the channel's half off the
 * schema that channel publishes. A schema that does not resolve to an object
 * shape names no fields, and everything the caller sent would go to the
 * provider's persist hook — which states its own fields exhaustively, so the
 * rule would be dropped on the way to storage.
 *
 * Nothing about that failure is loud: the save answers 200 and the automation
 * stops firing. So the shape every provider publishes is held here rather than
 * left to whichever change first introduces a union, an intersection, or a
 * schema library whose objects are a different class.
 */
import { describe, expect, it } from "vitest";
import { SERVER_PROVIDERS } from "../providers/registry";
import { deliveryFieldNames } from "../trigger-redaction";

describe("given every delivery channel this server offers", () => {
  const entries = Object.entries(SERVER_PROVIDERS);

  it("covers every channel the registry claims", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  describe("when the fields it owns are read off its schema", () => {
    it.each(entries)("names them for %s", (_action, entry) => {
      expect([
        ...deliveryFieldNames(entry.shared.actionParamsSchema),
      ]).not.toEqual([]);
    });
  });
});
