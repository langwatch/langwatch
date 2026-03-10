import { describe, expect, it } from "vitest";
import { isSafeImageUrl } from "../route";

describe("isSafeImageUrl", () => {
  describe("when URL is valid and external", () => {
    it("accepts https image URLs", () => {
      expect(isSafeImageUrl("https://example.com/image.png")).toBe(true);
    });

    it("accepts http image URLs", () => {
      expect(isSafeImageUrl("http://example.com/image.jpg")).toBe(true);
    });

    it("accepts URLs with ports", () => {
      expect(isSafeImageUrl("https://example.com:8080/image.png")).toBe(true);
    });
  });

  describe("when URL has a disallowed scheme", () => {
    it("rejects javascript: URLs", () => {
      expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects file: URLs", () => {
      expect(isSafeImageUrl("file:///etc/passwd")).toBe(false);
    });

    it("rejects ftp: URLs", () => {
      expect(isSafeImageUrl("ftp://example.com/image.png")).toBe(false);
    });
  });

  describe("when URL is malformed", () => {
    it("rejects plain strings", () => {
      expect(isSafeImageUrl("not-a-url")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isSafeImageUrl("")).toBe(false);
    });
  });

  describe("when URL targets a private or internal host", () => {
    it("rejects localhost", () => {
      expect(isSafeImageUrl("http://localhost/image.png")).toBe(false);
    });

    it("rejects 127.0.0.1", () => {
      expect(isSafeImageUrl("http://127.0.0.1/image.png")).toBe(false);
    });

    it("rejects 127.x.x.x loopback range", () => {
      expect(isSafeImageUrl("http://127.0.0.2/image.png")).toBe(false);
    });

    it("rejects 10.x private range", () => {
      expect(isSafeImageUrl("http://10.0.0.1/image.png")).toBe(false);
    });

    it("rejects 172.16.x private range", () => {
      expect(isSafeImageUrl("http://172.16.0.1/image.png")).toBe(false);
    });

    it("rejects 172.31.x private range", () => {
      expect(isSafeImageUrl("http://172.31.255.255/image.png")).toBe(false);
    });

    it("accepts 172.32.x (outside private range)", () => {
      expect(isSafeImageUrl("http://172.32.0.1/image.png")).toBe(true);
    });

    it("rejects 192.168.x private range", () => {
      expect(isSafeImageUrl("http://192.168.1.1/image.png")).toBe(false);
    });

    it("rejects IPv6 loopback ::1", () => {
      expect(isSafeImageUrl("http://[::1]/image.png")).toBe(false);
    });

    it("rejects 0.0.0.0", () => {
      expect(isSafeImageUrl("http://0.0.0.0/image.png")).toBe(false);
    });

    it("rejects link-local 169.254.x range", () => {
      expect(isSafeImageUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    });
  });
});
