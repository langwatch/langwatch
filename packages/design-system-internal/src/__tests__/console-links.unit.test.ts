import { describe, expect, it } from "vitest";

import { consoleLinks } from "../console-links.ts";

const at = ({
  hostname,
  protocol = "https:",
  port = "1355",
}: {
  hostname: string;
  protocol?: string;
  port?: string;
}) => consoleLinks({ location: { protocol, hostname, port } });

describe("consoleLinks", () => {
  describe("given a service host in a stack", () => {
    it("links every console of that stack, keeping the scheme and port", () => {
      const chrome = at({ hostname: "mail.feat-x.langwatch.localhost" });
      expect(chrome.slug).toBe("feat-x");
      expect(chrome.homeHref).toBe("https://feat-x.langwatch.localhost:1355");
      expect(chrome.hubHref).toBe("https://hub.langwatch.localhost:1355");
      expect(chrome.links).toEqual([
        { label: "Home", href: "https://feat-x.langwatch.localhost:1355" },
        { label: "Hub", href: "https://hub.langwatch.localhost:1355" },
        { label: "App", href: "https://app.feat-x.langwatch.localhost:1355" },
        { label: "Mail", href: "https://mail.feat-x.langwatch.localhost:1355", current: true },
        { label: "IdP", href: "https://idp.feat-x.langwatch.localhost:1355" },
        {
          label: "Design system",
          href: "https://design-system.feat-x.langwatch.localhost:1355",
        },
        { label: "Mail room", href: "https://mail-room.feat-x.langwatch.localhost:1355" },
      ]);
    });

    it("marks the IdP simulator current on its own host", () => {
      const current = at({ hostname: "idp.feat-x.langwatch.localhost" }).links.filter(
        (link) => link.current,
      );
      expect(current.map((link) => link.label)).toEqual(["IdP"]);
    });

    it("marks nothing current on a service with no console link", () => {
      const chrome = at({ hostname: "api.feat-x.langwatch.localhost" });
      expect(chrome.slug).toBe("feat-x");
      expect(chrome.links.some((link) => link.current)).toBe(false);
    });
  });

  describe("given a stack home host", () => {
    it("marks Home current", () => {
      const chrome = at({ hostname: "feat-x.langwatch.localhost" });
      expect(chrome.slug).toBe("feat-x");
      expect(chrome.links.find((link) => link.current)?.label).toBe("Home");
    });
  });

  describe("given the default port", () => {
    it("writes no port", () => {
      const chrome = at({ hostname: "mail.feat-x.langwatch.localhost", port: "" });
      expect(chrome.homeHref).toBe("https://feat-x.langwatch.localhost");
    });
  });

  describe("given a machine-wide host", () => {
    it.each([
      "idp.langwatch.localhost",
      "langwatch.localhost",
      "observability.langwatch.localhost",
    ])("links the hub alone from %s", (hostname) => {
      expect(at({ hostname, port: "" })).toEqual({
        hubHref: "https://hub.langwatch.localhost",
        links: [{ label: "Hub", href: "https://hub.langwatch.localhost" }],
      });
    });

    it("marks the hub current on the hub", () => {
      expect(at({ hostname: "hub.langwatch.localhost" })).toEqual({
        hubHref: "https://hub.langwatch.localhost:1355",
        links: [{ label: "Hub", href: "https://hub.langwatch.localhost:1355", current: true }],
      });
    });
  });

  describe("given a host outside the scheme", () => {
    it.each([
      "localhost",
      "127.0.0.1",
      "idp.hub.langwatch.localhost",
      "a.b.feat-x.langwatch.localhost",
      "app.langwatch.ai",
    ])("links nowhere from %s", (hostname) => {
      expect(at({ hostname, protocol: "http:", port: "5580" })).toEqual({ links: [] });
    });
  });
});
