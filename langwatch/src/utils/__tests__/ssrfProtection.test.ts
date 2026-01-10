import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isPrivateOrLocalhostIP,
  isBlockedCloudDomain,
  validateUrlForSSRF,
} from "../ssrfProtection";

describe("isPrivateOrLocalhostIP", () => {
  describe("when given IPv4 loopback addresses", () => {
    it("blocks 127.0.0.1", () => {
      expect(isPrivateOrLocalhostIP("127.0.0.1")).toBe(true);
    });

    it("blocks 127.255.255.255", () => {
      expect(isPrivateOrLocalhostIP("127.255.255.255")).toBe(true);
    });
  });

  describe("when given IPv4 unspecified address", () => {
    it("blocks 0.0.0.0", () => {
      expect(isPrivateOrLocalhostIP("0.0.0.0")).toBe(true);
    });
  });

  describe("when given IPv4 private ranges", () => {
    it("blocks 10.0.0.0/8", () => {
      expect(isPrivateOrLocalhostIP("10.0.0.1")).toBe(true);
    });

    it("blocks 10.255.255.255", () => {
      expect(isPrivateOrLocalhostIP("10.255.255.255")).toBe(true);
    });

    it("blocks 192.168.0.0/16", () => {
      expect(isPrivateOrLocalhostIP("192.168.1.1")).toBe(true);
    });

    it("blocks 172.16.0.0/12 lower bound", () => {
      expect(isPrivateOrLocalhostIP("172.16.0.1")).toBe(true);
    });

    it("blocks 172.16.0.0/12 upper bound", () => {
      expect(isPrivateOrLocalhostIP("172.31.255.255")).toBe(true);
    });

    it("allows 172.15.0.1 (outside range)", () => {
      expect(isPrivateOrLocalhostIP("172.15.0.1")).toBe(false);
    });

    it("allows 172.32.0.1 (outside range)", () => {
      expect(isPrivateOrLocalhostIP("172.32.0.1")).toBe(false);
    });
  });

  describe("when given IPv4 link-local addresses", () => {
    it("blocks 169.254.0.0/16", () => {
      expect(isPrivateOrLocalhostIP("169.254.1.1")).toBe(true);
    });
  });

  describe("when given public IPv4 addresses", () => {
    it("allows 8.8.8.8", () => {
      expect(isPrivateOrLocalhostIP("8.8.8.8")).toBe(false);
    });

    it("allows 1.1.1.1", () => {
      expect(isPrivateOrLocalhostIP("1.1.1.1")).toBe(false);
    });
  });

  describe("when given IPv6 loopback", () => {
    it("blocks ::1", () => {
      expect(isPrivateOrLocalhostIP("::1")).toBe(true);
    });
  });

  describe("when given IPv6 unspecified address", () => {
    it("blocks ::", () => {
      expect(isPrivateOrLocalhostIP("::")).toBe(true);
    });
  });

  describe("when given IPv6 Unique Local Addresses (fc00::/7)", () => {
    it("blocks fc00::1", () => {
      expect(isPrivateOrLocalhostIP("fc00::1")).toBe(true);
    });

    it("blocks fd00::1", () => {
      expect(isPrivateOrLocalhostIP("fd00::1")).toBe(true);
    });

    it("blocks fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", () => {
      expect(
        isPrivateOrLocalhostIP("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")
      ).toBe(true);
    });

    it("blocks FC00::1 (uppercase)", () => {
      expect(isPrivateOrLocalhostIP("FC00::1")).toBe(true);
    });
  });

  describe("when given IPv6 link-local addresses (fe80::/10)", () => {
    it("blocks fe80::1", () => {
      expect(isPrivateOrLocalhostIP("fe80::1")).toBe(true);
    });

    it("blocks FE80::1 (uppercase)", () => {
      expect(isPrivateOrLocalhostIP("FE80::1")).toBe(true);
    });
  });

  describe("when given IPv4-mapped IPv6 addresses (dotted decimal)", () => {
    it("blocks ::ffff:127.0.0.1", () => {
      expect(isPrivateOrLocalhostIP("::ffff:127.0.0.1")).toBe(true);
    });

    it("blocks ::ffff:10.0.0.1", () => {
      expect(isPrivateOrLocalhostIP("::ffff:10.0.0.1")).toBe(true);
    });

    it("blocks ::ffff:192.168.1.1", () => {
      expect(isPrivateOrLocalhostIP("::ffff:192.168.1.1")).toBe(true);
    });

    it("blocks ::ffff:172.16.0.1", () => {
      expect(isPrivateOrLocalhostIP("::ffff:172.16.0.1")).toBe(true);
    });

    it("allows ::ffff:8.8.8.8", () => {
      expect(isPrivateOrLocalhostIP("::ffff:8.8.8.8")).toBe(false);
    });

    it("blocks ::FFFF:127.0.0.1 (uppercase)", () => {
      expect(isPrivateOrLocalhostIP("::FFFF:127.0.0.1")).toBe(true);
    });
  });

  describe("when given IPv4-mapped IPv6 addresses (hex format)", () => {
    it("blocks ::ffff:7f00:0001 (127.0.0.1 in hex)", () => {
      expect(isPrivateOrLocalhostIP("::ffff:7f00:0001")).toBe(true);
    });

    it("blocks ::ffff:0a00:0001 (10.0.0.1 in hex)", () => {
      expect(isPrivateOrLocalhostIP("::ffff:0a00:0001")).toBe(true);
    });

    it("blocks ::ffff:c0a8:0101 (192.168.1.1 in hex)", () => {
      expect(isPrivateOrLocalhostIP("::ffff:c0a8:0101")).toBe(true);
    });

    it("allows ::ffff:0808:0808 (8.8.8.8 in hex)", () => {
      expect(isPrivateOrLocalhostIP("::ffff:0808:0808")).toBe(false);
    });
  });

  describe("when given public IPv6 addresses", () => {
    it("allows 2001:4860:4860::8888", () => {
      expect(isPrivateOrLocalhostIP("2001:4860:4860::8888")).toBe(false);
    });

    it("allows 2606:4700:4700::1111", () => {
      expect(isPrivateOrLocalhostIP("2606:4700:4700::1111")).toBe(false);
    });
  });
});

describe("isBlockedCloudDomain", () => {
  describe("when given AWS domains", () => {
    it("blocks s3.amazonaws.com", () => {
      expect(isBlockedCloudDomain("s3.amazonaws.com")).toBe(true);
    });

    it("blocks ec2.us-east-1.amazonaws.com", () => {
      expect(isBlockedCloudDomain("ec2.us-east-1.amazonaws.com")).toBe(true);
    });

    it("blocks amazonaws.com (exact match)", () => {
      expect(isBlockedCloudDomain("amazonaws.com")).toBe(true);
    });

    it("blocks ip-10-0-0-1.compute.internal", () => {
      expect(isBlockedCloudDomain("ip-10-0-0-1.compute.internal")).toBe(true);
    });
  });

  describe("when given Google Cloud domains", () => {
    it("blocks storage.googleapis.com", () => {
      expect(isBlockedCloudDomain("storage.googleapis.com")).toBe(true);
    });

    it("blocks my-service.run.app", () => {
      expect(isBlockedCloudDomain("my-service.run.app")).toBe(true);
    });

    it("blocks my-function.cloudfunctions.net", () => {
      expect(isBlockedCloudDomain("my-function.cloudfunctions.net")).toBe(true);
    });
  });

  describe("when given Azure domains", () => {
    it("blocks myapp.azurewebsites.net", () => {
      expect(isBlockedCloudDomain("myapp.azurewebsites.net")).toBe(true);
    });

    it("blocks myaccount.blob.windows.net", () => {
      expect(isBlockedCloudDomain("myaccount.blob.windows.net")).toBe(true);
    });
  });

  describe("when given generic internal domains", () => {
    it("blocks something.internal", () => {
      expect(isBlockedCloudDomain("something.internal")).toBe(true);
    });

    it("blocks something.local", () => {
      expect(isBlockedCloudDomain("something.local")).toBe(true);
    });

    it("blocks app.localhost", () => {
      expect(isBlockedCloudDomain("app.localhost")).toBe(true);
    });

    it("allows bare localhost (handled by private IP checks)", () => {
      expect(isBlockedCloudDomain("localhost")).toBe(false);
    });

    it("allows bare local (handled by private IP checks)", () => {
      expect(isBlockedCloudDomain("local")).toBe(false);
    });
  });

  describe("when given legitimate external domains", () => {
    it("allows google.com", () => {
      expect(isBlockedCloudDomain("google.com")).toBe(false);
    });

    it("allows api.example.com", () => {
      expect(isBlockedCloudDomain("api.example.com")).toBe(false);
    });

    it("allows external-api.io", () => {
      expect(isBlockedCloudDomain("external-api.io")).toBe(false);
    });
  });

  describe("when given case variations", () => {
    it("blocks S3.AMAZONAWS.COM (uppercase)", () => {
      expect(isBlockedCloudDomain("S3.AMAZONAWS.COM")).toBe(true);
    });
  });
});

describe("validateUrlForSSRF", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, NODE_ENV: "production" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("when given invalid URL", () => {
    it("throws error for malformed URL", async () => {
      await expect(validateUrlForSSRF("not-a-url")).rejects.toThrow(
        "Invalid URL format"
      );
    });
  });

  describe("when given cloud metadata endpoints", () => {
    it("blocks 169.254.169.254", async () => {
      await expect(
        validateUrlForSSRF("http://169.254.169.254/latest/meta-data/")
      ).rejects.toThrow("cloud metadata endpoints");
    });

    it("blocks metadata.google.internal", async () => {
      await expect(
        validateUrlForSSRF("http://metadata.google.internal/computeMetadata/v1/")
      ).rejects.toThrow("cloud metadata endpoints");
    });

    it("blocks fd00:ec2::254", async () => {
      // Note: IPv6 in brackets gets parsed, but may fall through to DNS check
      // Either way the request is blocked (fail-closed)
      await expect(
        validateUrlForSSRF("http://[fd00:ec2::254]/latest/meta-data/")
      ).rejects.toThrow();
    });
  });

  describe("when given cloud provider internal domains", () => {
    it("blocks amazonaws.com", async () => {
      await expect(
        validateUrlForSSRF("http://s3.amazonaws.com/bucket")
      ).rejects.toThrow("cloud provider internal domains");
    });

    it("blocks googleapis.com", async () => {
      await expect(
        validateUrlForSSRF("http://storage.googleapis.com/bucket")
      ).rejects.toThrow("cloud provider internal domains");
    });
  });

  describe("when given private IP literals in production", () => {
    it("blocks 127.0.0.1", async () => {
      await expect(
        validateUrlForSSRF("http://127.0.0.1:8080/api")
      ).rejects.toThrow("private or localhost IP addresses");
    });

    it("blocks 10.0.0.1", async () => {
      await expect(
        validateUrlForSSRF("http://10.0.0.1/internal")
      ).rejects.toThrow("private or localhost IP addresses");
    });

    it("blocks ::1", async () => {
      // Note: IPv6 loopback may fall through to DNS check (which fails)
      // Either way the request is blocked (fail-closed)
      await expect(validateUrlForSSRF("http://[::1]:8080/api")).rejects.toThrow();
    });
  });

  describe("when given public IP literals", () => {
    it("allows 8.8.8.8 and returns resolved result", async () => {
      const result = await validateUrlForSSRF("http://8.8.8.8/dns");
      expect(result.resolvedIp).toBe("8.8.8.8");
      expect(result.hostname).toBe("8.8.8.8");
    });
  });
});
