import { describe, expect, it, vi, beforeEach } from "vitest";
import dns from "dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import {
  createSSRFValidator,
  createSSRFSafeFetchConfig,
  fetchWithResolvedIp,
  type SSRFDevelopmentBypassResult,
  type SSRFResolvedResult,
} from "./ssrfProtection";

vi.mock("dns/promises", () => ({
  default: {
    resolve: vi.fn(),
  },
}));

vi.mock("undici", async () => {
  const actual = await vi.importActual("undici");
  return {
    ...actual,
    fetch: vi.fn(),
  };
});

const mockedFetch = vi.mocked(undiciFetch);

const mockedDnsResolve = vi.mocked(dns.resolve);

function stubDnsResolve(ipv4: string[], ipv6: string[] = []) {
  mockedDnsResolve.mockImplementation((hostname: string, type: string) => {
    if (type === "A") return Promise.resolve(ipv4);
    if (type === "AAAA") return Promise.resolve(ipv6);
    return Promise.resolve([]);
  });
}

describe("createSSRFValidator()", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("when isSaaS is false", () => {
    const validate = createSSRFValidator({
      isDevelopment: false,
      allowedDevHosts: [],
      isSaaS: false,
    });

    it("allows a private hostname", async () => {
      stubDnsResolve(["192.168.1.100"]);

      const result = await validate("https://my-internal-agent:8443/chat");
      expect(result.hostname).toBe("my-internal-agent");
    });

    it("allows a private IP literal like 10.0.0.5", async () => {
      const result = await validate("https://10.0.0.5:8443/chat");
      expect(result).toMatchObject({
        type: "resolved",
        resolvedIp: "10.0.0.5",
      });
    });

    it("blocks cloud metadata endpoints", async () => {
      await expect(
        validate("http://169.254.169.254/latest/meta-data/")
      ).rejects.toThrow(
        "Access to cloud metadata endpoints is not allowed for security reasons"
      );
    });

    it("blocks cloud provider internal domains", async () => {
      stubDnsResolve(["52.94.76.1"]);

      await expect(
        validate("https://s3.amazonaws.com/my-bucket")
      ).rejects.toThrow(
        "Access to cloud provider internal domains is not allowed for security reasons"
      );
    });
  });

  describe("when isSaaS is true", () => {
    const validate = createSSRFValidator({
      isDevelopment: false,
      allowedDevHosts: [],
      isSaaS: true,
    });

    it("blocks a private hostname", async () => {
      stubDnsResolve(["192.168.1.100"]);

      await expect(
        validate("https://my-internal-agent:8443/chat")
      ).rejects.toThrow(
        /not allowed for security reasons/
      );
    });

    it("blocks a private IP literal like 10.0.0.5", async () => {
      await expect(
        validate("https://10.0.0.5:8443/chat")
      ).rejects.toThrow(
        "Access to private or localhost IP addresses is not allowed for security reasons"
      );
    });

    it("blocks cloud metadata endpoints", async () => {
      await expect(
        validate("http://169.254.169.254/latest/meta-data/")
      ).rejects.toThrow(
        "Access to cloud metadata endpoints is not allowed for security reasons"
      );
    });

    it("blocks cloud provider internal domains", async () => {
      stubDnsResolve(["52.94.76.1"]);

      await expect(
        validate("https://s3.amazonaws.com/my-bucket")
      ).rejects.toThrow(
        "Access to cloud provider internal domains is not allowed for security reasons"
      );
    });
  });
});

describe("createSSRFSafeFetchConfig()", () => {
  describe("when isSaaS is false", () => {
    it("disables TLS certificate validation", () => {
      const config = createSSRFSafeFetchConfig({ isSaaS: false });
      expect(config.rejectUnauthorized).toBe(false);
    });
  });

  describe("when isSaaS is true", () => {
    it("enables TLS certificate validation", () => {
      const config = createSSRFSafeFetchConfig({ isSaaS: true });
      expect(config.rejectUnauthorized).toBe(true);
    });
  });
});

describe("fetchWithResolvedIp()", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("when resolvedIp is null (development-bypass)", () => {
    const devBypassResult: SSRFDevelopmentBypassResult = {
      type: "development-bypass",
      reason: "dns-failed",
      originalUrl: "http://my-service:3000/api",
      hostname: "my-service",
      port: 3000,
      protocol: "http:",
      path: "/api",
    };

    it("creates a non-pinning Agent with the provided TLS config", async () => {
      const fakeResponse = { status: 200, headers: new Headers() };
      mockedFetch.mockResolvedValue(fakeResponse as never);

      await fetchWithResolvedIp(devBypassResult, undefined, {
        rejectUnauthorized: false,
      });

      expect(mockedFetch).toHaveBeenCalledOnce();
      const callArgs = mockedFetch.mock.calls[0]!;
      const options = callArgs[1] as Record<string, unknown>;
      expect(options.dispatcher).toBeInstanceOf(Agent);
    });

    it("uses injected TLS config instead of module default", async () => {
      const fakeResponse = { status: 200, headers: new Headers() };
      mockedFetch.mockResolvedValue(fakeResponse as never);

      // Passing rejectUnauthorized: false (on-prem mode)
      await fetchWithResolvedIp(devBypassResult, undefined, {
        rejectUnauthorized: false,
      });

      expect(mockedFetch).toHaveBeenCalledOnce();
    });
  });

  describe("when resolvedIp is present", () => {
    const resolvedResult: SSRFResolvedResult = {
      type: "resolved",
      resolvedIp: "93.184.216.34",
      originalUrl: "https://example.com/api",
      hostname: "example.com",
      port: 443,
      protocol: "https:",
      path: "/api",
    };

    it("creates an IP-pinning Agent with injected TLS config", async () => {
      const fakeResponse = { status: 200, headers: new Headers() };
      mockedFetch.mockResolvedValue(fakeResponse as never);

      await fetchWithResolvedIp(resolvedResult, undefined, {
        rejectUnauthorized: true,
      });

      expect(mockedFetch).toHaveBeenCalledOnce();
      const callArgs = mockedFetch.mock.calls[0]!;
      const options = callArgs[1] as Record<string, unknown>;
      expect(options.dispatcher).toBeInstanceOf(Agent);
    });
  });
});
