import { EmailDeliveryPort, type EmailContent } from "@langwatch/notification-server";
import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";
import { ApiComposedPasswordResetMail } from "../api-better-auth.composition";
import { tryCreateApiMailComposition, type ApiMailComposition } from "../api-mail.composition";
import { resolveApiConfig } from "../../platform/config/api.config";

/**
 * The password-reset mail, driven to a gateway that records what it was given.
 *
 * The absence this replaces was recorded as a React-boundary refusal, and that
 * reason was false: `@langwatch/mail` is the one terminal
 * `frontend-boundary.unit.test.ts` allows a backend graph to enter. So the
 * template is reached here for real — react-email renders the message in
 * process — and what the gateway receives is the HTML a person would open,
 * carrying the link they would click. A test that stopped at "the adapter
 * called something" would have passed against the refusing stub too.
 */
class RecordingGateway extends EmailDeliveryPort {
  readonly sent: EmailContent[] = [];

  override defaultFrom(): string {
    return "LangWatch <no-reply@example.test>";
  }

  override async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return undefined;
  }
}

function composedMail(gateway: EmailDeliveryPort): ApiMailComposition {
  return { delivery: gateway, baseHost: "https://app.example.test" };
}

describe("tryCreateApiMailComposition", () => {
  describe("given a deployment that named no BASE_HOST", () => {
    it("composes no mail at all, rather than a gateway with nothing to link to", () => {
      const composition = tryCreateApiMailComposition({
        config: resolveApiConfig({ EMAIL_DEFAULT_FROM: "LangWatch <no-reply@example.test>" }),
        resources: new ResourceScope(),
      });

      expect(composition).toBeUndefined();
    });
  });

  describe("given a deployment that named a BASE_HOST", () => {
    it("composes a gateway whose sender is the configured one", () => {
      const composition = tryCreateApiMailComposition({
        config: resolveApiConfig({
          BASE_HOST: "https://app.example.test",
          EMAIL_DEFAULT_FROM: "LangWatch <no-reply@example.test>",
        }),
        resources: new ResourceScope(),
      });

      expect(composition?.baseHost).toBe("https://app.example.test");
      expect(composition?.delivery.defaultFrom()).toBe("LangWatch <no-reply@example.test>");
    });

    it("hands the transport to the scope, so shutdown closes the pool it opened", async () => {
      const resources = new ResourceScope();

      tryCreateApiMailComposition({
        config: resolveApiConfig({ BASE_HOST: "https://app.example.test" }),
        resources,
      });

      // No throw is the assertion: an unowned SMTP pool or SES client is a
      // handle the process never releases, and the scope is what releases it.
      await expect(resources.close()).resolves.toBeUndefined();
    });
  });

  describe("given no resource scope to own the transport", () => {
    it("composes nothing, because a gateway nobody can close leaks for the life of the process", () => {
      const composition = tryCreateApiMailComposition({
        config: resolveApiConfig({ BASE_HOST: "https://app.example.test" }),
      });

      expect(composition).toBeUndefined();
    });
  });
});

describe("ApiComposedPasswordResetMail", () => {
  describe("when Better Auth asks for a reset link to be sent", () => {
    it("delivers the rendered message to the address that asked for it", async () => {
      const gateway = new RecordingGateway();

      await ApiComposedPasswordResetMail.create(composedMail(gateway)).sendResetPassword({
        email: "member@acme.test",
        token: "tok en/+1",
      });

      expect(gateway.sent).toHaveLength(1);
      expect(gateway.sent[0]?.to).toBe("member@acme.test");
      expect(gateway.sent[0]?.subject).toBe("Reset your LangWatch password");
    });

    /** @scenario The reset link is rooted at the deployment's own URL and carries the token */
    it("carries a reset link on this deployment's own host, with the token URL-encoded", async () => {
      const gateway = new RecordingGateway();

      await ApiComposedPasswordResetMail.create(composedMail(gateway)).sendResetPassword({
        email: "member@acme.test",
        token: "tok en/+1",
      });

      // The whole point of the message. Better Auth hands over a raw token, and
      // a `+` or a `/` reaching the query string unencoded is a link that
      // resolves to a different token than the one that was minted.
      expect(gateway.sent[0]?.html).toContain(
        "https://app.example.test/auth/reset-password?token=tok%20en%2F%2B1",
      );
    });

    it("renders the address it is about into the body, so the person can tell which account", async () => {
      const gateway = new RecordingGateway();

      await ApiComposedPasswordResetMail.create(composedMail(gateway)).sendResetPassword({
        email: "member@acme.test",
        token: "tok-1",
      });

      expect(gateway.sent[0]?.html).toContain("member@acme.test");
      expect(gateway.sent[0]?.html).toContain("Reset password");
    });
  });
});
