// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import {
  pinnedEndpointConfig,
  pinnedHandlerOptions,
  pinnedHostsConfig,
  pinnedHostsLookup,
  pinnedLookup,
} from "../s3.object-store.channel.ts";

const base = {
  originalUrl: "https://sqs.example.com/",
  hostname: "sqs.example.com",
  port: 443,
  protocol: "https:",
  path: "/",
};

function lookupOnce(lookup: ReturnType<typeof pinnedLookup>, all: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    lookup("rebound.example.com", { all }, (error, address, family) =>
      error ? reject(error) : resolve(all ? address : { address, family }),
    );
  });
}

describe("pinnedLookup", () => {
  it("answers any name with the judged address", async () => {
    const lookup = pinnedLookup("203.0.113.7");

    await expect(lookupOnce(lookup, false)).resolves.toEqual({ address: "203.0.113.7", family: 4 });
    await expect(lookupOnce(lookup, true)).resolves.toEqual([
      { address: "203.0.113.7", family: 4 },
    ]);
  });
});

describe("pinnedEndpointConfig", () => {
  it("refuses an endpoint the fence could not resolve", () => {
    expect(() =>
      pinnedEndpointConfig({ ...base, type: "unresolved", reason: "dns-failed" }),
    ).toThrow(/did not resolve/);
  });

  it("builds a handler for a resolved endpoint", () => {
    expect(
      pinnedEndpointConfig({ ...base, type: "resolved", resolvedIp: "203.0.113.7" }),
    ).toBeDefined();
  });

  it("refuses an allowlisted host the fence did not resolve", () => {
    expect(() => pinnedEndpointConfig({ ...base, type: "allowlisted" })).toThrow(/did not resolve/);
  });
});

describe("pinnedHandlerOptions", () => {
  it("keeps enforced connection and request deadlines beside the pinned agents", () => {
    const options = pinnedHandlerOptions(pinnedLookup("203.0.113.7"));

    expect(options).toMatchObject({
      connectionTimeout: 5_000,
      requestTimeout: 20_000,
      throwOnRequestTimeout: true,
    });
    expect(options.httpAgent).toBeDefined();
    expect(options.httpsAgent).toBeDefined();
  });
});

describe("pinnedHostsConfig", () => {
  it("leaves the client alone when no host was judged", () => {
    expect(pinnedHostsConfig([])).toEqual({});
  });

  it("refuses when one judged host did not resolve", () => {
    expect(() =>
      pinnedHostsConfig([
        { ...base, type: "resolved", resolvedIp: "203.0.113.7" },
        { ...base, hostname: "queue.acme.example", type: "allowlisted" },
      ]),
    ).toThrow(/queue.acme.example did not resolve/);
  });
});

describe("pinnedHostsLookup", () => {
  it("answers each judged host with its own address", async () => {
    const lookup = pinnedHostsLookup(
      new Map([
        ["sqs.example.com", "203.0.113.7"],
        ["queue.acme.example", "198.51.100.9"],
      ]),
    );
    const answer = (hostname: string) =>
      new Promise((resolve, reject) =>
        lookup(hostname, {}, (error, address) => (error ? reject(error) : resolve(address))),
      );

    await expect(answer("SQS.example.com")).resolves.toBe("203.0.113.7");
    await expect(answer("queue.acme.example")).resolves.toBe("198.51.100.9");
  });
});
