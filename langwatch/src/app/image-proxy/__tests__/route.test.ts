import { describe, expect, it, vi } from "vitest";
import { isSafeImageUrl } from "../route";

// Mock DNS so tests are deterministic and don't hit the network.
// resolvesToPrivateAddress is only called for non-IP hostnames that pass the
// fast-path pattern check, so we only need to cover "example.com" here.
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]),
    resolve6: vi.fn().mockResolvedValue([]),
  },
}));

describe("isSafeImageUrl", () => {
  describe("when URL is valid and external", () => {
    it("accepts https image URLs", async () => {
      expect(await isSafeImageUrl("https://example.com/image.png")).toBe(true);
    });

    it("accepts http image URLs", async () => {
      expect(await isSafeImageUrl("http://example.com/image.jpg")).toBe(true);
    });

    it("accepts URLs with ports", async () => {
      expect(
        await isSafeImageUrl("https://example.com:8080/image.png"),
      ).toBe(true);
    });
  });

  describe("when URL has a disallowed scheme", () => {
    it("rejects javascript: URLs", async () => {
      expect(await isSafeImageUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects file: URLs", async () => {
      expect(await isSafeImageUrl("file:///etc/passwd")).toBe(false);
    });

    it("rejects ftp: URLs", async () => {
      expect(await isSafeImageUrl("ftp://example.com/image.png")).toBe(false);
    });
  });

  describe("when URL is malformed", () => {
    it("rejects plain strings", async () => {
      expect(await isSafeImageUrl("not-a-url")).toBe(false);
    });

    it("rejects empty string", async () => {
      expect(await isSafeImageUrl("")).toBe(false);
    });
  });

  describe("when URL targets a private or internal host", () => {
    it("rejects localhost", async () => {
      expect(await isSafeImageUrl("http://localhost/image.png")).toBe(false);
    });

    it("rejects 127.0.0.1", async () => {
      expect(await isSafeImageUrl("http://127.0.0.1/image.png")).toBe(false);
    });

    it("rejects 127.x.x.x loopback range", async () => {
      expect(await isSafeImageUrl("http://127.0.0.2/image.png")).toBe(false);
    });

    it("rejects 10.x private range", async () => {
      expect(await isSafeImageUrl("http://10.0.0.1/image.png")).toBe(false);
    });

    it("rejects 172.16.x private range", async () => {
      expect(await isSafeImageUrl("http://172.16.0.1/image.png")).toBe(false);
    });

    it("rejects 172.31.x private range", async () => {
      expect(await isSafeImageUrl("http://172.31.255.255/image.png")).toBe(
        false,
      );
    });

    it("accepts 172.32.x (outside private range)", async () => {
      expect(await isSafeImageUrl("http://172.32.0.1/image.png")).toBe(true);
    });

    it("rejects 192.168.x private range", async () => {
      expect(await isSafeImageUrl("http://192.168.1.1/image.png")).toBe(false);
    });

    it("rejects IPv6 loopback ::1", async () => {
      expect(await isSafeImageUrl("http://[::1]/image.png")).toBe(false);
    });

    it("rejects 0.0.0.0", async () => {
      expect(await isSafeImageUrl("http://0.0.0.0/image.png")).toBe(false);
    });

    it("rejects link-local 169.254.x range", async () => {
      expect(
        await isSafeImageUrl("http://169.254.169.254/latest/meta-data"),
      ).toBe(false);
    });

    it("rejects IPv4-mapped IPv6 ::ffff:127.0.0.1", async () => {
      expect(
        await isSafeImageUrl("http://[::ffff:127.0.0.1]/image.png"),
      ).toBe(false);
    });

    it("rejects IPv4-mapped IPv6 ::ffff:192.168.1.1", async () => {
      expect(
        await isSafeImageUrl("http://[::ffff:192.168.1.1]/image.png"),
      ).toBe(false);
    });

    it("rejects IPv6 unique-local fc00::/7 (fc prefix)", async () => {
      expect(await isSafeImageUrl("http://[fc00::1]/image.png")).toBe(false);
    });

    it("rejects IPv6 unique-local fc00::/7 (fd prefix)", async () => {
      expect(
        await isSafeImageUrl("http://[fd12:3456:789a::1]/image.png"),
      ).toBe(false);
    });

    it("rejects IPv6 link-local fe80::/10", async () => {
      expect(await isSafeImageUrl("http://[fe80::1]/image.png")).toBe(false);
    });
  });

  describe("when hostname resolves to a private IP via DNS", () => {
    it("rejects a domain that resolves to 127.0.0.1", async () => {
      const { default: dns } = await import("node:dns/promises");
      vi.mocked(dns.resolve4).mockResolvedValueOnce(["127.0.0.1"]);
      vi.mocked(dns.resolve6).mockResolvedValueOnce([]);
      expect(await isSafeImageUrl("http://evil.example.com/image.png")).toBe(
        false,
      );
    });

    it("rejects a domain that resolves to a private 10.x IP", async () => {
      const { default: dns } = await import("node:dns/promises");
      vi.mocked(dns.resolve4).mockResolvedValueOnce(["10.0.0.1"]);
      vi.mocked(dns.resolve6).mockResolvedValueOnce([]);
      expect(
        await isSafeImageUrl("http://internal.corp.example.com/image.png"),
      ).toBe(false);
    });

    it("rejects a domain that resolves to any private IP even alongside public IPs", async () => {
      const { default: dns } = await import("node:dns/promises");
      vi.mocked(dns.resolve4).mockResolvedValueOnce([
        "93.184.216.34",
        "192.168.1.1",
      ]);
      vi.mocked(dns.resolve6).mockResolvedValueOnce([]);
      expect(
        await isSafeImageUrl("http://mixed.example.com/image.png"),
      ).toBe(false);
    });

    it("rejects a domain whose DNS cannot be resolved", async () => {
      const { default: dns } = await import("node:dns/promises");
      vi.mocked(dns.resolve4).mockRejectedValueOnce(
        new Error("ENOTFOUND nxdomain.example.com"),
      );
      vi.mocked(dns.resolve6).mockRejectedValueOnce(
        new Error("ENOTFOUND nxdomain.example.com"),
      );
      expect(
        await isSafeImageUrl("http://nxdomain.example.com/image.png"),
      ).toBe(false);
    });
  });
});
