import { GatewayInternalAuthenticationError } from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import {
  buildGatewayCanonicalString,
  computeGatewaySignature,
} from "../../rules/gateway-internal-identity.rules.ts";
import { GatewayInternalIdentityService } from "../gateway-internal-identity.service.ts";

const SECRET = "test-gateway-internal-secret";

function signedRequest({ signedPath, url }: { signedPath: string; url: string }): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeGatewaySignature(
    SECRET,
    buildGatewayCanonicalString({ method: "GET", path: signedPath, timestamp, body: "" }),
  );
  return new Request(url, {
    headers: {
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
    },
  });
}

describe("the gateway internal identity", () => {
  const identity = GatewayInternalIdentityService.create({ secret: SECRET });
  const path = "/api/internal/gateway/changes";

  it("admits a request whose signature covers its sorted query", () => {
    const request = signedRequest({
      signedPath: `${path}?organization_id=org-a&since=0`,
      url: `http://api.test${path}?since=0&organization_id=org-a`,
    });

    expect(identity.identify({ request, rawBody: "" }).internal).toBeDefined();
  });

  it("refuses a request whose query differs from the one signed", () => {
    const request = signedRequest({
      signedPath: path,
      url: `http://api.test${path}?organization_id=org-b`,
    });

    expect(() => identity.identify({ request, rawBody: "" })).toThrow(
      GatewayInternalAuthenticationError,
    );
  });
});
