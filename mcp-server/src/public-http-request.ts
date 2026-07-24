import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { classify } from "@langwatch/ssrf";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type DnsResolver = (hostname: string, options: { all: true; verbatim: true }) => Promise<ResolvedAddress[]>;

interface ResolvedAddress {
  address: string;
  family: number;
}

export interface PublicDestination {
  address: string;
  family: number;
  url: URL;
}

function unsafeDestinationError(): Error {
  return new Error("HTTP agent destinations must resolve only to globally routable public addresses");
}

function hostnameWithoutBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function assertPublicAddress(address: string): void {
  if (classify(address) !== "global") {
    throw unsafeDestinationError();
  }
}

export async function resolvePublicDestination(
  input: string,
  resolver: DnsResolver = dnsLookup
): Promise<PublicDestination> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("HTTP agent URL is invalid");
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
    throw unsafeDestinationError();
  }

  const hostname = hostnameWithoutBrackets(url.hostname);
  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    assertPublicAddress(hostname);
    return { address: hostname, family: literalFamily, url };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("HTTP agent destination could not be resolved");
  }

  if (addresses.length === 0) {
    throw new Error("HTTP agent destination could not be resolved");
  }

  for (const { address } of addresses) {
    assertPublicAddress(address);
  }

  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0]!;
  return {
    address: selected.address,
    family: selected.family,
    url,
  };
}

interface PublicJsonRequestOptions {
  body?: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  signal?: AbortSignal;
}

function requestBody(
  destination: PublicDestination,
  options: PublicJsonRequestOptions
): Promise<{ body: string; location?: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const hostname = hostnameWithoutBrackets(destination.url.hostname);
    const requestOptions: RequestOptions = {
      protocol: destination.url.protocol,
      hostname,
      port: destination.url.port || undefined,
      path: `${destination.url.pathname}${destination.url.search}`,
      method: options.method ?? "GET",
      headers: options.headers,
      family: destination.family,
      signal: options.signal,
      lookup: (_hostname, _options, callback) => {
        callback(null, destination.address, destination.family);
      },
    };
    const transport = destination.url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.once("aborted", () => {
        reject(new Error("HTTP agent response was interrupted"));
      });
      response.once("error", reject);

      const contentLength = Number(response.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        response.destroy(new Error("HTTP agent response is too large"));
        return;
      }

      response.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("HTTP agent response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          location: response.headers.location,
          statusCode: response.statusCode ?? 0,
        });
      });
    });

    request.once("error", reject);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("HTTP agent request timed out"));
    });
    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

export async function requestPublicJson(
  input: string,
  options: PublicJsonRequestOptions = {},
  redirectCount = 0
): Promise<Record<string, unknown>> {
  const destination = await resolvePublicDestination(input);
  const response = await requestBody(destination, options);

  if (REDIRECT_STATUSES.has(response.statusCode) && response.location) {
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error(`HTTP agent returned too many redirects`);
    }
    const redirectUrl = new URL(response.location, destination.url);
    const preserveBody = response.statusCode === 307 || response.statusCode === 308;
    return requestPublicJson(
      redirectUrl.toString(),
      preserveBody
        ? options
        : {
            ...options,
            body: undefined,
            method: "GET",
          },
      redirectCount + 1
    );
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP agent returned an unsuccessful status: ${response.statusCode}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error("HTTP agent returned invalid JSON");
  }

  return parsed as Record<string, unknown>;
}
