import { describe, expect, it } from "vitest";
import { TriggerNoReplyService, TriggerNoReplyWarningPort } from "../trigger-no-reply.service";
import { UnsubscribeTokenService } from "../unsubscribe-token.service";

/**
 * Spec: packages/features/automation/specs/unsubscribe-token-twin.feature
 *
 * The tokens and addresses below were RECORDED from
 * `platform/app/src/server/mailer/unsubscribeToken.ts` and
 * `platform/app/src/server/mailer/triggerNoReply.ts` under the key spelled
 * here. They are literals on purpose: a token minted by one process is read by
 * the other, out of somebody's inbox, and re-deriving the expectation from the
 * module under test would assert only that it agrees with itself.
 */
const SHARED_KEY = "0f".repeat(32);

const APPLICATION_TRIGGER_TOKEN =
  "eyJwcm9qZWN0SWQiOiJwcm9qZWN0LTEiLCJ0cmlnZ2VySWQiOiJ0cmlnZ2VyLTEiLCJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSJ9.aba1dbbe8d7ba211a0d91c962a5993e4d61fcc0b56c55c06c37e24cbbd5af6b1";
const APPLICATION_PROJECT_TOKEN =
  "eyJwcm9qZWN0SWQiOiJwcm9qZWN0LTEiLCJ0cmlnZ2VySWQiOm51bGwsImVtYWlsIjoiYWRhQGV4YW1wbGUuY29tIn0.ec785b87b9ec6dfda75a6bf6099fae99780222f09cba44b352eedac673ff18d0";

class RecordingWarnings extends TriggerNoReplyWarningPort {
  readonly messages: string[] = [];

  unguessabilityUnavailable(message: string): void {
    this.messages.push(message);
  }
}

describe("UnsubscribeTokenService", () => {
  describe("given the signing key both processes share", () => {
    const tokens = UnsubscribeTokenService.create({ secret: SHARED_KEY });

    /** @scenario "A token the application signed verifies here" */
    it("reads back the project, the automation and the recipient", () => {
      expect(tokens.tryVerify(APPLICATION_TRIGGER_TOKEN)).toEqual({
        projectId: "project-1",
        triggerId: "trigger-1",
        email: "ada@example.com",
      });
      expect(tokens.tryVerify(APPLICATION_PROJECT_TOKEN)).toEqual({
        projectId: "project-1",
        triggerId: null,
        email: "ada@example.com",
      });
    });

    /** @scenario "A token this feature signs is the application's bytes" */
    it("signs the bytes the application produces", () => {
      expect(
        tokens.sign({
          projectId: "project-1",
          triggerId: "trigger-1",
          // Cased and padded, as an author may have typed it: the format
          // normalizes before it signs, so the link works either way.
          email: "  Ada@Example.COM ",
        }),
      ).toBe(APPLICATION_TRIGGER_TOKEN);
      expect(
        tokens.sign({ projectId: "project-1", triggerId: null, email: "ada@example.com" }),
      ).toBe(APPLICATION_PROJECT_TOKEN);
    });
  });

  describe("given a token signed for one recipient", () => {
    const tokens = UnsubscribeTokenService.create({ secret: SHARED_KEY });

    /** @scenario "The address is bound to the recipient it was minted for" */
    it("refuses a token whose payload was altered", () => {
      const forged = `${Buffer.from(
        JSON.stringify({
          projectId: "project-1",
          triggerId: "trigger-1",
          email: "grace@example.com",
        }),
      ).toString("base64url")}.${APPLICATION_TRIGGER_TOKEN.split(".")[1]!}`;

      expect(tokens.tryVerify(forged)).toBeNull();
      expect(tokens.tryVerify(`${APPLICATION_TRIGGER_TOKEN}0`)).toBeNull();
      expect(tokens.tryVerify("not-a-token")).toBeNull();
    });

    /** @scenario "The address is bound to the recipient it was minted for" */
    it("refuses a token minted under a different key", () => {
      expect(
        UnsubscribeTokenService.create({ secret: "ab".repeat(32) }).tryVerify(
          APPLICATION_TRIGGER_TOKEN,
        ),
      ).toBeNull();
    });
  });

  describe("given no signing key", () => {
    /** @scenario "An absent signing key refuses to mint or verify a token" */
    it("refuses naming the setting the operator must supply", () => {
      const tokens = UnsubscribeTokenService.create({ secret: undefined });

      expect(() =>
        tokens.sign({ projectId: "project-1", triggerId: null, email: "ada@example.com" }),
      ).toThrow(/NEXTAUTH_SECRET/);
      expect(() => tokens.tryVerify(APPLICATION_TRIGGER_TOKEN)).toThrow(/NEXTAUTH_SECRET/);
    });
  });
});

describe("TriggerNoReplyService", () => {
  describe("given the signing key both processes share", () => {
    /** @scenario "The no-reply address is stable per automation" */
    it("builds the address the application builds", () => {
      const addresses = TriggerNoReplyService.create({ secret: SHARED_KEY });
      const built = addresses.addressFor({
        defaultFrom: "LangWatch <contact@langwatch.ai>",
        triggerId: "trigger-1",
      });

      expect(built).toBe("LangWatch Triggers <no-reply+81d9d46cce00@langwatch.ai>");
      expect(
        addresses.addressFor({
          defaultFrom: "LangWatch <contact@langwatch.ai>",
          triggerId: "trigger-1",
        }),
      ).toBe(built);
      expect(
        addresses.addressFor({
          defaultFrom: "Acme <alerts@mail.acme.test>",
          triggerId: "trigger-1",
        }),
      ).toBe("LangWatch Triggers <no-reply+81d9d46cce00@mail.acme.test>");
      // A deployment that wrote a bare address named no domain to read.
      expect(
        addresses.addressFor({ defaultFrom: "contact@acme.test", triggerId: "trigger-1" }),
      ).toBe("LangWatch Triggers <no-reply+81d9d46cce00@langwatch.ai>");
    });
  });

  describe("given no signing key", () => {
    /** @scenario "An absent signing key degrades the no-reply address rather than blocking" */
    it("still produces an address and says the tag is no longer unguessable", () => {
      const warnings = new RecordingWarnings();

      expect(
        TriggerNoReplyService.create({ secret: undefined, warnings }).addressFor({
          defaultFrom: "LangWatch <contact@langwatch.ai>",
          triggerId: "trigger-1",
        }),
      ).toBe("LangWatch Triggers <no-reply+b3c9a7064c50@langwatch.ai>");
      expect(warnings.messages).toEqual([
        "NEXTAUTH_SECRET is not set; no-reply trigger tags are forgeable and not unguessable. Set NEXTAUTH_SECRET to secure trigger email addresses.",
      ]);
    });
  });
});
