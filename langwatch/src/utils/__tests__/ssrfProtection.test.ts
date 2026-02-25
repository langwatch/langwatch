import { describe, expect, it } from "vitest";
import {
  createSSRFValidator,
  isBlockedCloudDomain,
  isPrivateOrLocalhostIP,
} from "../ssrfProtection";

describe("isPrivateOrLocalhostIP", () => {
  // [ip, shouldBlock]
  const cases: [string, boolean][] = [
    // IPv4 loopback
    ["127.0.0.1", true],
    ["127.255.255.255", true],
    // IPv4 unspecified
    ["0.0.0.0", true],
    // IPv4 private ranges
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["192.168.1.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.15.0.1", false], // outside 172.16-31 range
    ["172.32.0.1", false], // outside 172.16-31 range
    // IPv4 link-local
    ["169.254.1.1", true],
    // Public IPv4
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    // IPv6 loopback & unspecified
    ["::1", true],
    ["::", true],
    // IPv6 ULA (fc00::/7)
    ["fc00::1", true],
    ["fd00::1", true],
    ["fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true], // ULA upper bound
    ["FC00::1", true], // uppercase
    // IPv6 link-local
    ["fe80::1", true],
    ["FE80::1", true], // uppercase
    // IPv4-mapped IPv6 (dotted)
    ["::ffff:127.0.0.1", true],
    ["::ffff:10.0.0.1", true],
    ["::ffff:172.16.0.1", true], // IPv4-mapped 172.16.x.x range
    ["::ffff:192.168.1.1", true],
    ["::ffff:8.8.8.8", false],
    ["::FFFF:127.0.0.1", true], // uppercase
    // IPv4-mapped IPv6 (hex)
    ["::ffff:7f00:0001", true], // 127.0.0.1
    ["::ffff:0a00:0001", true], // 10.0.0.1
    ["::ffff:c0a8:0101", true], // 192.168.1.1
    ["::ffff:0808:0808", false], // 8.8.8.8
    // Public IPv6
    ["2001:4860:4860::8888", false],
    ["2606:4700:4700::1111", false],
  ];

  it.each(cases)("isPrivateOrLocalhostIP(%s) = %s", (ip, expected) => {
    expect(isPrivateOrLocalhostIP(ip)).toBe(expected);
  });
});

describe("isBlockedCloudDomain", () => {
  // [domain, shouldBlock]
  // Note: This is AWS-only config. GCP/Azure domains are NOT blocked.
  // See ssrfConstants.ts to extend for other cloud providers.
  const cases: [string, boolean][] = [
    // AWS domains (blocked)
    ["s3.amazonaws.com", true],
    ["ec2.us-east-1.amazonaws.com", true],
    ["amazonaws.com", true],
    ["ip-10-0-0-1.compute.internal", true],
    ["S3.AMAZONAWS.COM", true], // uppercase
    // Generic internal domains (blocked)
    ["something.internal", true],
    ["something.local", true],
    ["app.localhost", true],
    // Bare localhost/local (NOT blocked here - handled by IP checks)
    ["localhost", false],
    ["local", false],
    // GCP/Azure (NOT blocked in AWS-only config)
    ["storage.googleapis.com", false],
    ["my-service.run.app", false],
    ["my-function.cloudfunctions.net", false],
    ["myapp.azurewebsites.net", false],
    ["myaccount.blob.windows.net", false],
    // Legitimate external domains
    ["google.com", false],
    ["api.example.com", false],
    ["external-api.io", false],
  ];

  it.each(cases)("isBlockedCloudDomain(%s) = %s", (domain, expected) => {
    expect(isBlockedCloudDomain(domain)).toBe(expected);
  });
});

describe("validateUrlForSSRF", () => {
  // Use injected SaaS config for deterministic behavior regardless of env
  const saasValidator = createSSRFValidator({
    isDevelopment: false,
    allowedDevHosts: [],
    isSaaS: true,
  });

  // [url, expectedError] - urls that should be blocked in SaaS mode
  const blockedCases: [string, string][] = [
    ["not-a-url", "Invalid URL format"],
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata endpoints"],
    [
      "http://metadata.google.internal/computeMetadata/v1/",
      "cloud provider internal domains",
    ],
    ["http://s3.amazonaws.com/bucket", "cloud provider internal domains"],
    ["http://127.0.0.1:8080/api", "private or localhost IP addresses"],
    ["http://10.0.0.1/internal", "private or localhost IP addresses"],
  ];

  it.each(blockedCases)("blocks %s", async (url, expectedError) => {
    await expect(saasValidator(url)).rejects.toThrow(expectedError);
  });

  // URLs that should be blocked but error message varies (IPv6 edge cases)
  it.each([
    "http://[fd00:ec2::254]/latest/meta-data/",
    "http://[::1]:8080/api",
  ])("blocks %s (any error)", async (url) => {
    await expect(saasValidator(url)).rejects.toThrow();
  });

  it("allows public IP and returns resolved result", async () => {
    const result = await saasValidator("http://8.8.8.8/dns");
    expect(result.type).toBe("resolved");
    if (result.type === "resolved") {
      expect(result.resolvedIp).toBe("8.8.8.8");
    }
    expect(result.hostname).toBe("8.8.8.8");
  });

  it("allows googleapis.com (not blocked in AWS-only config)", async () => {
    const result = await saasValidator(
      "http://storage.googleapis.com/bucket",
    );
    expect(result.hostname).toBe("storage.googleapis.com");
  });

  it("returns discriminated union with correct type for development bypass", async () => {
    const devValidator = createSSRFValidator({
      isDevelopment: true,
      allowedDevHosts: [],
      isSaaS: true,
    });
    // In development mode without allowlist, unresolvable hostnames return development-bypass
    const result = await devValidator(
      "http://nonexistent-host-12345.invalid/path",
    );
    expect(result.type).toBe("development-bypass");
    if (result.type === "development-bypass") {
      expect(["dns-failed", "no-records"]).toContain(result.reason);
    }
  });
});

describe("createSSRFValidator (dependency injection)", () => {
  it("allows injecting custom configuration without process.env", async () => {
    const validator = createSSRFValidator({
      isDevelopment: false,
      allowedDevHosts: [],
      isSaaS: true,
    });

    // Should block private IPs in production config
    await expect(validator("http://127.0.0.1/api")).rejects.toThrow(
      "private or localhost IP addresses",
    );
  });

  it("respects injected development mode with allowlist", async () => {
    const validator = createSSRFValidator({
      isDevelopment: true,
      allowedDevHosts: ["myhost.local"],
      isSaaS: true,
    });

    // myhost.local is in the allowlist, but it's also a cloud domain pattern
    // Cloud domains are always blocked regardless of allowlist
    await expect(validator("http://myhost.local/api")).rejects.toThrow(
      "cloud provider internal domains",
    );
  });

  it("respects injected development mode without allowlist", async () => {
    const validator = createSSRFValidator({
      isDevelopment: true,
      allowedDevHosts: [],
      isSaaS: true,
    });

    // In dev mode without allowlist, private IPs are allowed
    const result = await validator("http://127.0.0.1/api");
    expect(result.type).toBe("resolved");
    if (result.type === "resolved") {
      expect(result.resolvedIp).toBe("127.0.0.1");
    }
  });

  it("always blocks metadata endpoints regardless of config", async () => {
    const validator = createSSRFValidator({
      isDevelopment: true,
      allowedDevHosts: ["169.254.169.254"],
      isSaaS: true,
    });

    // Metadata endpoints are always blocked, even if allowlisted
    await expect(
      validator("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow("cloud metadata endpoints");
  });
});
