import { execFileSync } from "node:child_process";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fetchValidatedDestination } from "../fenced-fetch.ts";
import {
  createSsrfUrlValidator,
  type PrivateEndpointBinding,
  type SsrfValidationResult,
} from "../url-validator.ts";

/**
 * Spec: specs/security/org-private-model-endpoints.feature (ADR-203). A bound hostname is
 * dialled at its registered addresses and never resolved; everything else is judged as before.
 */

const HOSTNAME = "llm.internal.acme.test";
const REGISTERED = ["10.20.1.21", "10.20.2.34"];
const BINDINGS: PrivateEndpointBinding[] = [
  { hostname: HOSTNAME, addresses: REGISTERED, port: 443 },
];

const strict = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });

afterEach(() => vi.restoreAllMocks());

describe("the address policy with private endpoint bindings", () => {
  describe("given a hostname the call's organization bound", () => {
    /** @scenario "A bound hostname is never resolved" */
    it("admits it at the registered addresses without a DNS lookup", async () => {
      const resolve = vi.spyOn(dnsPromises, "resolve");

      const result = await strict(`https://${HOSTNAME}/v1`, { privateEndpoints: BINDINGS });

      expect(resolve).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        type: "bound",
        hostname: HOSTNAME,
        port: 443,
        addresses: REGISTERED,
      });
    });

    it("matches the name whatever its case and a trailing dot", async () => {
      const result = await strict("https://LLM.Internal.Acme.Test./v1", {
        privateEndpoints: BINDINGS,
      });

      expect(result.type).toBe("bound");
    });
  });

  describe("given a bound hostname reached the wrong way", () => {
    /** @scenario "<url> is refused for a bound hostname" */
    it.each([`http://${HOSTNAME}/v1`, `https://${HOSTNAME}:8443/v1`])(
      "refuses %s before any connection",
      async (url) => {
        const resolve = vi.spyOn(dnsPromises, "resolve");

        await expect(strict(url, { privateEndpoints: BINDINGS })).rejects.toThrow(HOSTNAME);
        expect(resolve).not.toHaveBeenCalled();
      },
    );

    /** @scenario "A refusal does not reveal the registered addresses" */
    it("names the hostname and the port, never an address", async () => {
      const failure = await strict(`https://${HOSTNAME}:8443/v1`, {
        privateEndpoints: BINDINGS,
      }).catch((error: unknown) => error as Error);

      expect(failure.message).toContain(HOSTNAME);
      expect(failure.message).toContain("8443");
      for (const address of REGISTERED) expect(failure.message).not.toContain(address);
    });
  });

  describe("given what a binding can never admit", () => {
    /** @scenario "An IP-literal base URL is never treated as bound" */
    it("refuses an IP-literal base URL as a private address", async () => {
      await expect(strict("https://10.20.1.21/v1", { privateEndpoints: BINDINGS })).rejects.toThrow(
        /private or localhost IP/,
      );
    });

    it("never binds an IP literal, even when a binding names one", async () => {
      await expect(
        strict("https://10.20.1.21/v1", {
          privateEndpoints: [{ hostname: "10.20.1.21", addresses: REGISTERED, port: 443 }],
        }),
      ).rejects.toThrow(/private or localhost IP/);
    });

    it("refuses a binding whose addresses include a metadata address", async () => {
      await expect(
        strict(`https://${HOSTNAME}/v1`, {
          privateEndpoints: [{ hostname: HOSTNAME, addresses: ["169.254.169.254"], port: 443 }],
        }),
      ).rejects.toThrow(/no usable address/);
    });
  });

  describe("given a hostname nobody bound", () => {
    function dnsAnswers(address: string) {
      return vi
        .spyOn(dnsPromises, "resolve")
        .mockImplementation((async (_host: string, type: string) =>
          type === "A" ? [address] : []) as never);
    }

    /** @scenario "Another organization cannot use Acme's binding" */
    it("resolves it as usual and refuses a private answer", async () => {
      const resolve = dnsAnswers("10.20.1.21");

      await expect(strict(`https://${HOSTNAME}/v1`)).rejects.toThrow(/private or localhost IP/);
      await expect(
        strict(`https://${HOSTNAME}/v1`, {
          privateEndpoints: [{ hostname: "other.acme.test", addresses: REGISTERED, port: 443 }],
        }),
      ).rejects.toThrow(/private or localhost IP/);
      expect(resolve).toHaveBeenCalled();
    });

    it("judges a public answer exactly as without bindings", async () => {
      dnsAnswers("93.184.216.34");

      const unbound = await strict("https://api.example.test/v1");
      const withOthers = await strict("https://api.example.test/v1", {
        privateEndpoints: BINDINGS,
      });

      expect(withOthers).toEqual(unbound);
    });

    /** @scenario "With BLOCK_LOCAL_HTTP_CALLS false, an unbound private host is allowed" */
    it("allows a private address where the install allows private calls", async () => {
      const relaxed = createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] });

      await expect(relaxed("https://10.0.5.3/v1")).resolves.toMatchObject({
        type: "resolved",
        resolvedIp: "10.0.5.3",
      });
    });
  });
});

describe("the pinned fetch to a bound hostname", () => {
  let directory: string;
  let server: https.Server;
  let port: number;
  const seen: { servername: string | false | undefined; host: string | undefined }[] = [];

  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "egress-binding-"));
    const keyPath = path.join(directory, "key.pem");
    const certPath = path.join(directory, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        `/CN=${HOSTNAME}`,
        "-addext",
        `subjectAltName=DNS:${HOSTNAME}`,
      ],
      { stdio: "ignore" },
    );
    server = https.createServer(
      { key: readFileSync(keyPath), cert: readFileSync(certPath) },
      (req, res) => {
        const socket = req.socket as typeof req.socket & { servername?: string | false };
        seen.push({ servername: socket.servername, host: req.headers.host });
        res.end("ok");
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server is not listening");
    port = address.port;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function bound(addresses: string[]): SsrfValidationResult {
    return {
      type: "bound",
      originalUrl: `https://${HOSTNAME}:${port}/v1/models`,
      hostname: HOSTNAME,
      port,
      protocol: "https:",
      path: "/v1/models",
      addresses,
    };
  }

  /** @scenario "A bound hostname is never resolved" */
  it("connects to the registered address, keeping the hostname for SNI and Host", async () => {
    const lookup = vi.spyOn(dns, "lookup");
    seen.length = 0;

    const response = await fetchValidatedDestination(bound(["127.0.0.1"]), undefined, {
      rejectUnauthorized: false,
    });

    expect(await response.text()).toBe("ok");
    expect(lookup).not.toHaveBeenCalled();
    expect(seen).toEqual([{ servername: HOSTNAME, host: `${HOSTNAME}:${port}` }]);
  });

  /** @scenario "The second address is tried when the first refuses" */
  it("tries the next registered address when the first refuses", async () => {
    seen.length = 0;

    const response = await fetchValidatedDestination(bound(["::1", "127.0.0.1"]), undefined, {
      rejectUnauthorized: false,
    });

    expect(await response.text()).toBe("ok");
    expect(seen).toHaveLength(1);
  });

  it("verifies the certificate for the hostname, not the address", async () => {
    const failure = await fetchValidatedDestination(bound(["127.0.0.1"]), undefined, {
      rejectUnauthorized: true,
    }).catch((error: unknown) => error as Error);

    expect(failure.message).toContain(HOSTNAME);
    expect(failure.message).not.toContain("127.0.0.1");
  });

  it("never sends a bound hostname through the outbound proxy", async () => {
    seen.length = 0;

    const response = await fetchValidatedDestination(
      bound(["127.0.0.1"]),
      { proxy: { httpsProxy: "http://127.0.0.1:9" } },
      { rejectUnauthorized: false },
    );

    expect(await response.text()).toBe("ok");
    expect(seen).toHaveLength(1);
  });

  /** @scenario "A refusal does not reveal the registered addresses" */
  it("names the hostname, never the address, when no registered address answers", async () => {
    const closed = https.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const address = closed.address();
    if (!address || typeof address === "string") throw new Error("server is not listening");
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const failure = await fetchValidatedDestination(
      { ...bound(["127.0.0.1"]), port: address.port },
      undefined,
      { rejectUnauthorized: false },
    ).catch((error: unknown) => error as Error);

    expect(failure.message).toContain(HOSTNAME);
    expect(failure.message).not.toContain("127.0.0.1");
  });
});
