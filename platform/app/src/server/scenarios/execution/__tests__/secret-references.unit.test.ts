/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../adapters/auth.strategies";
import {
  preserveSecretRefs,
  redactSecrets,
  resolveAuthSecrets,
  resolveSecretRefs,
  resolveSecretRefsInTemplate,
  resolveSecretsInMap,
} from "../secret-references";

const SECRETS = { AGENT_TOKEN: "tok-live-123", OTHER: "other-value" };

describe("secret references", () => {
  describe("given a reference to a name the project has", () => {
    it("substitutes the value", () => {
      expect(
        resolveSecretRefs("Bearer {{ secrets.AGENT_TOKEN }}", SECRETS),
      ).toBe("Bearer tok-live-123");
    });

    it("accepts the reference without inner spacing", () => {
      expect(resolveSecretRefs("{{secrets.AGENT_TOKEN}}", SECRETS)).toBe(
        "tok-live-123",
      );
    });

    it("substitutes every occurrence", () => {
      expect(
        resolveSecretRefs(
          "{{ secrets.AGENT_TOKEN }}/{{ secrets.OTHER }}",
          SECRETS,
        ),
      ).toBe("tok-live-123/other-value");
    });
  });

  describe("given a reference to a name the project does not have", () => {
    /** @scenario "A reference to a missing secret name stays verbatim in the request" */
    it("leaves the reference exactly as written", () => {
      expect(resolveSecretRefs("{{ secrets.NOT_A_SECRET }}", SECRETS)).toBe(
        "{{ secrets.NOT_A_SECRET }}",
      );
    });

    it("leaves it as written when the project has no secrets at all", () => {
      expect(resolveSecretRefs("{{ secrets.AGENT_TOKEN }}", {})).toBe(
        "{{ secrets.AGENT_TOKEN }}",
      );
    });
  });

  describe("given a string a template engine renders afterwards", () => {
    it("fences a resolved value off from the render", () => {
      expect(
        resolveSecretRefsInTemplate(
          "https://api.test/{{ secrets.AGENT_TOKEN }}",
          SECRETS,
        ),
      ).toBe("https://api.test/{% raw %}tok-live-123{% endraw %}");
    });

    it("fences an unresolved reference off so it survives the render", () => {
      expect(
        resolveSecretRefsInTemplate("https://api.test/{{ secrets.NOPE }}", {}),
      ).toBe("https://api.test/{% raw %}{{ secrets.NOPE }}{% endraw %}");
    });

    it("fences without resolving when nothing may be substituted", () => {
      expect(preserveSecretRefs("body {{ secrets.AGENT_TOKEN }} end")).toBe(
        "body {% raw %}{{ secrets.AGENT_TOKEN }}{% endraw %} end",
      );
    });
  });

  describe("given a record of header values", () => {
    it("resolves the values and leaves the keys alone", () => {
      expect(
        resolveSecretsInMap(
          { "X-Api-Key": "{{ secrets.AGENT_TOKEN }}", Accept: "text/plain" },
          SECRETS,
        ),
      ).toEqual({ "X-Api-Key": "tok-live-123", Accept: "text/plain" });
    });
  });

  describe("given an auth config", () => {
    it("resolves a bearer token", () => {
      expect(
        resolveAuthSecrets(
          { type: "bearer", token: "{{ secrets.AGENT_TOKEN }}" },
          SECRETS,
        ),
      ).toEqual({ type: "bearer", token: "tok-live-123" });
    });

    it("resolves an api key value and leaves the header name alone", () => {
      expect(
        resolveAuthSecrets(
          {
            type: "api_key",
            header: "X-{{ secrets.AGENT_TOKEN }}",
            value: "{{ secrets.AGENT_TOKEN }}",
          },
          SECRETS,
        ),
      ).toEqual({
        type: "api_key",
        header: "X-{{ secrets.AGENT_TOKEN }}",
        value: "tok-live-123",
      });
    });

    it("resolves a basic username and password", () => {
      expect(
        resolveAuthSecrets(
          {
            type: "basic",
            username: "{{ secrets.OTHER }}",
            password: "{{ secrets.AGENT_TOKEN }}",
          },
          SECRETS,
        ),
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

      resolveAuthSecrets(auth, SECRETS);

      expect(auth.token).toBe("{{ secrets.AGENT_TOKEN }}");
    });
  });

  describe("given a message that carries a resolved secret value", () => {
    it("replaces every occurrence with the placeholder", () => {
      expect(
        redactSecrets(
          'Get "https://api.test?token=tok-live-123": dial tcp, sent tok-live-123',
          SECRETS,
        ),
      ).toBe(
        'Get "https://api.test?token=[redacted]": dial tcp, sent [redacted]',
      );
    });

    it("leaves a message that carries none unchanged", () => {
      expect(redactSecrets("HTTP 500: upstream is down", SECRETS)).toBe(
        "HTTP 500: upstream is down",
      );
    });

    it("ignores an empty secret value rather than replacing everything", () => {
      expect(redactSecrets("anything at all", { EMPTY: "" })).toBe(
        "anything at all",
      );
    });
  });
});
