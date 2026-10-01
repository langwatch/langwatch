/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { HostedMcpModule } from "../../app/hosted-mcp.app.ts";
import { HOSTED_MCP_FAMILY, hostedMcpRoutePolicies } from "../../rules/mcp-routes.rules.ts";
import type { AuthzMcpSessionGrantService } from "../../services/authz-mcp-session-grant.service.ts";
import { HeaderMcpClientAddressService } from "../../services/header-mcp-client-address.service.ts";
import type { McpApiKeyCipher } from "../../services/mcp-oauth-token.service.ts";
import type {
  McpLiveProjectLookup,
  ProjectMcpProjectLookupService,
} from "../../services/project-mcp-project-lookup.service.ts";
import { FakeCliSessions } from "./support/fake-cli-sessions.ts";
import { getRoutePolicy } from "@langwatch/api";

class NoProjects implements Pick<ProjectMcpProjectLookupService, "resolveLiveProjectByApiKey"> {
  resolveLiveProjectByApiKey(): Promise<McpLiveProjectLookup> {
    return Promise.resolve({ kind: "unknown" });
  }
}

class NoGrants implements Pick<AuthzMcpSessionGrantService, "stillGranted"> {
  stillGranted(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

class PlainCipher implements McpApiKeyCipher {
  encrypt(value: string): string {
    return value;
  }
  decrypt(value: string): string {
    return value;
  }
}

function handler() {
  return HostedMcpModule.fromDependencies({
    redis: null,
    projects: new NoProjects(),
    grants: new NoGrants(),
    cliSessions: new FakeCliSessions(),
    cipher: new PlainCipher(),
    address: HeaderMcpClientAddressService.create(),
    baseHost: "https://app.langwatch.ai",
  }).createHandler();
}

/** Every path the dispatcher claims, transcribed from its own switch. */
const DISPATCHED_PATHS = [
  "/mcp",
  "/mcp/health",
  "/sse",
  "/messages",
  "/sse/messages",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-protected-resource/sse",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/mcp",
  "/.well-known/oauth-authorization-server/sse",
  "/.well-known/openid-configuration",
  "/oauth/register",
  "/oauth/token",
];

describe("given the hosted MCP route policy declarations", () => {
  describe("when they are compared with the paths the dispatcher claims", () => {
    /** @scenario "Every path the dispatcher claims carries a declared policy" */
    it("declares each claimed path and claims each declared path", () => {
      const declared = new Set(hostedMcpRoutePolicies().map((route) => route.path));
      const claims = handler();

      expect([...declared].toSorted()).toEqual([...DISPATCHED_PATHS].toSorted());
      for (const path of declared) {
        expect(claims.isMcpRoute(path)).toBe(true);
      }
    });
  });

  describe("when the declared credential is read", () => {
    /** @scenario "The transport routes declare the credential they accept" */
    it("puts the transport behind an API key and leaves the handshake public", () => {
      const byVerb = new Map(
        hostedMcpRoutePolicies().map((route) => [`${route.method} ${route.path}`, route]),
      );

      expect(byVerb.get("POST /mcp")?.policy).toMatchObject({
        kind: "handlerManaged",
        credential: "apiKey",
        permissions: [],
      });
      expect(byVerb.get("POST /oauth/token")?.policy.kind).toBe("public");
      expect(byVerb.get("GET /mcp/health")?.policy.kind).toBe("public");
      expect(byVerb.get("OPTIONS /mcp")?.policy.kind).toBe("public");
      expect(byVerb.get("POST /mcp")?.family).toBe(HOSTED_MCP_FAMILY);
    });
  });

  describe("when the endpoint is composed", () => {
    /** @scenario "Composing the endpoint puts its routes in the registry" */
    it("records every verb it serves in the process-wide route registry", () => {
      handler();

      for (const route of hostedMcpRoutePolicies()) {
        expect(getRoutePolicy(route.method, route.path)).toMatchObject({
          family: HOSTED_MCP_FAMILY,
          credentialClass: route.credentialClass,
        });
      }
    });
  });
});
