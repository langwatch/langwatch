import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseOutboundProxyConfig } from "~/server/outboundProxy";
import {
  closeAwsClientConfiguration,
  configureAwsClientConfiguration,
} from "~/runtime/app/aws-client.composition";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
}));

vi.mock("../../../../env.mjs", () => ({ env: mockEnv }));

import { buildSesClientConfig } from "../ses";

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;

const originalProxyEnv = Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function transportOptions(config: ReturnType<typeof buildSesClientConfig>) {
  const handler = config.requestHandler;
  if (!isRecord(handler)) throw new Error("SES must receive a NodeHttpHandler");

  const provider = handler["configProvider"];
  if (!(provider instanceof Promise)) throw new Error("NodeHttpHandler config must be available");

  const options = await provider;
  if (!isRecord(options)) throw new Error("NodeHttpHandler config must be an object");
  return options;
}

function proxyHref(agent: unknown): string | undefined {
  if (!isRecord(agent)) return undefined;
  const proxy = agent["proxy"];
  return proxy instanceof URL ? proxy.href : undefined;
}

async function httpAgent(options: Record<string, unknown>): Promise<unknown> {
  const provider = options["httpAgentProvider"];
  if (typeof provider !== "function") throw new Error("NodeHttpHandler must provide an HTTP agent");
  return provider();
}

describe("SES proxy composition", () => {
  beforeEach(async () => {
    await closeAwsClientConfiguration();
    for (const key of PROXY_ENV_KEYS) delete process.env[key];
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];
    mockEnv.AWS_REGION = "eu-central-1";
  });

  afterEach(async () => {
    await closeAwsClientConfiguration();
    for (const [key, value] of Object.entries(originalProxyEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each([
    [
      "prefers HTTPS_PROXY",
      { HTTPS_PROXY: "http://https-preferred.corp:8080", HTTP_PROXY: "http://fallback.corp:8080" },
      "http://https-preferred.corp:8080/",
    ],
    [
      "falls back to HTTP_PROXY",
      { HTTP_PROXY: "http://http-fallback.corp:8080" },
      "http://http-fallback.corp:8080/",
    ],
    [
      "uses lowercase proxy variables",
      { https_proxy: "http://lowercase-proxy.corp:8080" },
      "http://lowercase-proxy.corp:8080/",
    ],
  ])("%s and wires the same agent for HTTP and HTTPS", async (_, proxyEnv, expectedProxy) => {
    Object.assign(process.env, proxyEnv);
    configureAwsClientConfiguration(parseOutboundProxyConfig(process.env));

    const options = await transportOptions(buildSesClientConfig());

    expect(proxyHref(options["httpsAgent"])).toBe(expectedProxy);
    await expect(httpAgent(options)).resolves.toBe(options["httpsAgent"]);
  });

  it.each([
    ["an exact host", "mail-relay.internal.corp"],
    ["a parent domain", ".internal.corp"],
    ["a wildcard", "*"],
  ])("connects directly when NO_PROXY has %s", async (_, noProxy) => {
    mockEnv.AWS_SES_ENDPOINT = "mail-relay.internal.corp:465";
    process.env.HTTPS_PROXY = "http://excluded-proxy.corp:8080";
    process.env.NO_PROXY = noProxy;
    configureAwsClientConfiguration(parseOutboundProxyConfig(process.env));

    const options = await transportOptions(buildSesClientConfig());

    expect(proxyHref(options["httpsAgent"])).toBeUndefined();
  });

  it("reuses the direct handler when no proxy applies", () => {
    configureAwsClientConfiguration({});
    const first = buildSesClientConfig();
    const second = buildSesClientConfig();

    expect(second.requestHandler).toBe(first.requestHandler);
  });

  it("bypasses a proxy for a scheme-less custom SES endpoint", async () => {
    mockEnv.AWS_SES_ENDPOINT = "mail-relay.internal.corp:465";
    process.env.HTTPS_PROXY = "http://excluded-proxy.corp:8080";
    process.env.NO_PROXY = ".internal.corp";
    configureAwsClientConfiguration(parseOutboundProxyConfig(process.env));

    const options = await transportOptions(buildSesClientConfig());

    expect(proxyHref(options["httpsAgent"])).toBeUndefined();
  });
});
