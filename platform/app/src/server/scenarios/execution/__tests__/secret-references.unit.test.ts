/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../adapters/auth.strategies";
import {
  fenceSecretRefs,
  preserveSecretRefs,
  redactSecrets,
  resolveAuthSecrets,
  resolveSecretRefs,
} from "../secret-references";

const SECRETS = { AGENT_TOKEN: "tok-live-123", OTHER: "other-value" };

describe("secret references", () => {
  describe("given a reference to a name the project has", () => {
    it("substitutes the value", () => {
      expect(
        resolveSecretRefs({
          value: "Bearer {{ secrets.AGENT_TOKEN }}",
          secrets: SECRETS,
        }),
      ).toBe("Bearer tok-live-123");
    });

    it("accepts the reference without inner spacing", () => {
      expect(
        resolveSecretRefs({
          value: "{{secrets.AGENT_TOKEN}}",
          secrets: SECRETS,
        }),
      ).toBe("tok-live-123");
    });

    it("substitutes every occurrence", () => {
      expect(
        resolveSecretRefs({
          value: "{{ secrets.AGENT_TOKEN }}/{{ secrets.OTHER }}",
          secrets: SECRETS,
        }),
      ).toBe("tok-live-123/other-value");
    });
  });

  describe("given a reference to a name the project does not have", () => {
    /** @scenario "A reference to a missing secret name stays verbatim in the request" */
    it("leaves the reference exactly as written", () => {
      expect(
        resolveSecretRefs({
          value: "{{ secrets.NOT_A_SECRET }}",
          secrets: SECRETS,
        }),
      ).toBe("{{ secrets.NOT_A_SECRET }}");
    });

    it("leaves it as written when the project has no secrets at all", () => {
      expect(resolveSecretRefs({ value: "{{ secrets.AGENT_TOKEN }}", secrets: {} })).toBe(
        "{{ secrets.AGENT_TOKEN }}",
      );
    });
  });

  describe("given a string a template engine renders afterwards", () => {
    /** Render stands in for the engine: it never sees a secret value. */
    const roundTrip = ({
      template,
      secrets,
    }: {
      template: string;
      secrets: Record<string, string>;
    }) => {
      const fenced = fenceSecretRefs({ template, secrets });
      return fenced.restore(fenced.template);
    };

    it("keeps the resolved value out of what gets rendered", () => {
      const fenced = fenceSecretRefs({
        template: "https://api.test/{{ secrets.AGENT_TOKEN }}",
        secrets: SECRETS,
      });

      expect(fenced.template).not.toContain("tok-live-123");
      expect(fenced.restore(fenced.template)).toBe("https://api.test/tok-live-123");
    });

    it("puts an unresolved reference back exactly as written", () => {
      expect(
        roundTrip({
          template: "https://api.test/{{ secrets.NOPE }}",
          secrets: {},
        }),
      ).toBe("https://api.test/{{ secrets.NOPE }}");
    });

    it("holds a reference out without resolving it when nothing may be substituted", () => {
      const fenced = preserveSecretRefs("body {{ secrets.AGENT_TOKEN }} end");

      expect(fenced.template).not.toContain("secrets.AGENT_TOKEN");
      expect(fenced.restore(fenced.template)).toBe("body {{ secrets.AGENT_TOKEN }} end");
    });

    it("leaves a template with no reference in it byte for byte", () => {
      const fenced = fenceSecretRefs({
        template: "https://api.test/{{ params.region }}",
        secrets: SECRETS,
      });

      expect(fenced.template).toBe("https://api.test/{{ params.region }}");
    });

    it("survives a secret value that is itself a fence-closing tag", () => {
      expect(
        roundTrip({
          template: "{{ secrets.TRICKY }}",
          secrets: { TRICKY: "a{% endraw %}b" },
        }),
      ).toBe("a{% endraw %}b");
    });
  });

  describe("given an auth config", () => {
    it("resolves a bearer token", () => {
      expect(
        resolveAuthSecrets({
          auth: { type: "bearer", token: "{{ secrets.AGENT_TOKEN }}" },
          secrets: SECRETS,
        }),
      ).toEqual({ type: "bearer", token: "tok-live-123" });
    });

    it("resolves an api key value and leaves the header name alone", () => {
      expect(
        resolveAuthSecrets({
          auth: {
            type: "api_key",
            header: "X-{{ secrets.AGENT_TOKEN }}",
            value: "{{ secrets.AGENT_TOKEN }}",
          },
          secrets: SECRETS,
        }),
      ).toEqual({
        type: "api_key",
        header: "X-{{ secrets.AGENT_TOKEN }}",
        value: "tok-live-123",
      });
    });

    it("resolves a basic username and password", () => {
      expect(
        resolveAuthSecrets({
          auth: {
            type: "basic",
            username: "{{ secrets.OTHER }}",
            password: "{{ secrets.AGENT_TOKEN }}",
          },
          secrets: SECRETS,
        }),
      ).toEqual({
        type: "basic",
        username: "other-value",
        password: "tok-live-123",
      });
    });

    it("leaves the caller's config untouched", () => {
      const auth: AuthConfig = {
        type: "bearer",
        token: "{{ secrets.AGENT_TOKEN }}",
      };

      resolveAuthSecrets({ auth, secrets: SECRETS });

      expect(auth.token).toBe("{{ secrets.AGENT_TOKEN }}");
    });
  });

  describe("given a message that carries a resolved secret value", () => {
    it("replaces every occurrence with the placeholder", () => {
      expect(
        redactSecrets({
          message:
            'Get "https://api.test?token=tok-live-123": dial tcp, sent tok-live-123',
          secrets: SECRETS,
        }),
      ).toBe('Get "https://api.test?token=[redacted]": dial tcp, sent [redacted]');
    });

    it("leaves a message that carries none unchanged", () => {
      expect(
        redactSecrets({
          message: "HTTP 500: upstream is down",
          secrets: SECRETS,
        }),
      ).toBe("HTTP 500: upstream is down");
    });

    it("ignores an empty secret value rather than replacing everything", () => {
      expect(redactSecrets({ message: "anything at all", secrets: { EMPTY: "" } })).toBe(
        "anything at all",
      );
    });
  });
});
