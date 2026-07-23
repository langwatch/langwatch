/**
 * @vitest-environment jsdom
 *
 * The security-relevant half of the leaving-LangWatch guard: deciding what a
 * link in the Langy panel ACTUALLY points at.
 *
 * Langy renders model output, so a link's words are attacker-shapeable. Every
 * case below is a way of making an address read as LangWatch when it is not,
 * or of smuggling something that is not a destination at all into an anchor.
 *
 * (jsdom because the classifier reuses `isInternalHref` from the Markdown
 * component, which pulls in the React renderer.)
 */
import { describe, expect, it } from "vitest";

import { classifyLangyLinkDestination } from "../logic/langyLinkDestination";

const APP_ORIGIN = "https://app.langwatch.ai";

function classify(href: string, appOrigin: string = APP_ORIGIN) {
  return classifyLangyLinkDestination({ href, appOrigin });
}

describe("given a destination that is LangWatch's own", () => {
  /** @scenario Reading the true destination */
  it.each([
    ["an in-app absolute path", "/my-project/messages/abc123"],
    ["an in-app path with a query", "/my-project/traces?q=timeouts"],
    ["a relative path", "messages/abc123"],
    ["the app's own origin", "https://app.langwatch.ai/my-project"],
    ["the marketing site", "https://langwatch.ai/pricing"],
    ["the documentation site", "https://docs.langwatch.ai/introduction"],
    ["an uppercased host", "https://LANGWATCH.AI/pricing"],
    ["a protocol-relative link to our own host", "//app.langwatch.ai/x"],
  ])("treats %s as inside LangWatch", (_case, href) => {
    expect(classify(href).kind).toBe("internal");
  });

  describe("when the app is served from a self-hosted origin", () => {
    it("treats that origin as inside LangWatch", () => {
      expect(
        classify("https://langwatch.acme.internal/p/traces", "https://langwatch.acme.internal")
          .kind,
      ).toBe("internal");
    });

    it("still treats the LangWatch documentation as inside LangWatch", () => {
      expect(
        classify("https://docs.langwatch.ai/introduction", "https://langwatch.acme.internal")
          .kind,
      ).toBe("internal");
    });
  });
});

describe("given a destination dressed up to look like LangWatch", () => {
  /** @scenario Reading the true destination */
  it.each([
    ["userinfo before the real host", "https://langwatch.ai@evil.example/login"],
    ["a password-shaped userinfo", "https://langwatch.ai:x@evil.example/login"],
    ["our name as a subdomain of theirs", "https://langwatch.ai.evil.com/login"],
    ["our name glued onto theirs", "https://notlangwatch.ai/login"],
    ["our name as a suffix without the dot", "https://evillangwatch.ai/login"],
    ["our name in the path only", "https://evil.example/langwatch.ai/login"],
    ["our name in the query only", "https://evil.example/?next=https://langwatch.ai"],
    ["our name in the fragment only", "https://evil.example/#https://docs.langwatch.ai"],
    ["a protocol-relative jump off-site", "//evil.com/login"],
    ["a bare off-site host", "https://example.com/pricing"],
  ])("treats %s as outside LangWatch", (_case, href) => {
    expect(classify(href).kind).toBe("external");
  });

  it("reports the host the browser will really contact, not the one in the address bar text", () => {
    const verdict = classify("https://langwatch.ai@evil.example/login");
    expect(verdict).toMatchObject({ kind: "external", host: "evil.example" });
  });

  describe("when the host is spelled with lookalike letters", () => {
    /** @scenario A host that merely looks like langwatch.ai is outside */
    it("does not accept it as LangWatch", () => {
      // "langwatch" here starts with a Cyrillic а, which reads identically.
      const verdict = classify("https://lаngwatch.ai/login");
      expect(verdict.kind).toBe("external");
    });

    /** @scenario A host that merely looks like langwatch.ai is outside */
    it("names the resolved host rather than the letters that were typed", () => {
      const verdict = classify("https://lаngwatch.ai/login");
      expect(verdict.kind === "external" && verdict.host).not.toBe(
        "langwatch.ai",
      );
    });
  });
});

describe("given an address that is not somewhere to go", () => {
  /** @scenario Reading the true destination */
  it.each([
    ["a script URL", "javascript:alert(1)"],
    ["an inline document", "data:text/html,<h1>hi</h1>"],
    ["a blob URL", "blob:https://evil.example/9f2"],
    ["a local file", "file:///etc/passwd"],
    ["a scheme with no host", "https://"],
    ["an unparseable address", "http://["],
  ])("refuses to open %s", (_case, href) => {
    expect(classify(href).kind).toBe("unsupported");
  });

  /** @scenario Reading the true destination */
  it.each([
    ["an empty address", ""],
    ["whitespace only", "   "],
    ["an in-page anchor", "#results"],
    ["an email address", "mailto:hello@example.com"],
    ["a phone number", "tel:+3120000000"],
  ])("leaves %s to the browser", (_case, href) => {
    expect(classify(href).kind).toBe("ignored");
  });
});

describe("given the panel is rendered before an origin is known", () => {
  it("refuses a relative address rather than guessing where it lands", () => {
    expect(classify("messages/abc123", "").kind).toBe("unsupported");
  });

  it("still recognises an in-app absolute path", () => {
    expect(classify("/my-project/messages/abc123", "").kind).toBe("internal");
  });

  it("still recognises a LangWatch host", () => {
    expect(classify("https://docs.langwatch.ai/x", "").kind).toBe("internal");
  });
});
