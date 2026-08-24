import { describe, expect, it } from "vitest";
import {
  destinationConfigWithEmailRecipients,
  emailRecipientsFromDestinationConfig,
  parseDestinationConfigForEditor,
} from "../destinationConfigEditor";

describe("destination config email editor", () => {
  describe("given mixed valid and invalid persisted destinations", () => {
    describe("when email recipients are edited", () => {
      it("preserves valid webhooks while exposing invalid email strings for repair", () => {
        const raw = JSON.stringify({
          destinations: [
            { type: "webhook", url: "https://hooks.example.com/governance" },
            {
              type: "email",
              to: ["broken-address", 42, "member@example.com"],
            },
            { type: "slack", channel: "alerts" },
            { type: "webhook", url: "http://not-secure.example.com" },
          ],
        });

        expect(emailRecipientsFromDestinationConfig(raw)).toBe(
          "broken-address\nmember@example.com",
        );
        expect(
          parseDestinationConfigForEditor(raw).nonEmailDestinations,
        ).toEqual([
          { type: "webhook", url: "https://hooks.example.com/governance" },
        ]);

        expect(
          JSON.parse(
            destinationConfigWithEmailRecipients({
              raw,
              recipientsText: "fixed@example.com",
            }),
          ),
        ).toEqual({
          destinations: [
            { type: "webhook", url: "https://hooks.example.com/governance" },
            { type: "email", to: ["fixed@example.com"] },
          ],
        });
      });
    });
  });

  describe("given a persisted config with non-array destinations", () => {
    describe("when email recipients are edited", () => {
      it("treats the config as empty before adding recipients", () => {
        const raw = JSON.stringify({ destinations: { type: "email" } });

        expect(parseDestinationConfigForEditor(raw)).toEqual({
          emailRecipients: [],
          nonEmailDestinations: [],
        });
        expect(
          JSON.parse(
            destinationConfigWithEmailRecipients({
              raw,
              recipientsText: "new@example.com",
            }),
          ),
        ).toEqual({
          destinations: [{ type: "email", to: ["new@example.com"] }],
        });
      });
    });
  });
});
