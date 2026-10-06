/**
 * @vitest-environment node
 *
 * `organization.getAll` over a real tRPC host: the verified session reaches the surface.
 * Spec: specs/auth/verified-session-on-request-context.feature
 */
import type { Authorize } from "@langwatch/api/access";
import { SessionReader, type SessionCaller } from "@langwatch/api/hosting";
import { bindTrpcFact, composeTrpcRouters, TrpcHost } from "@langwatch/api/trpc";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it, vi } from "vitest";

import { organizationSessionPersonFact, organizationTrpcTransport } from "../organization.trpc.ts";

function served({ session }: { session: SessionCaller | null }) {
  const listVisibleOrganizations = vi.fn<OrganizationApi["listVisibleOrganizations"]>(
    async () => [],
  );
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => session }),
    authz: createApiFixture<Authorize>({ checkScopeLineage: async () => ({ kind: "consistent" }) }),
    entitlements: { holds: async () => true },
    facts: [
      bindTrpcFact(organizationSessionPersonFact, (ctx) =>
        ctx.session?.user
          ? {
              name: ctx.session.user.name ?? null,
              email: ctx.session.user.email ?? null,
              image: ctx.session.user.image ?? null,
            }
          : null,
      ),
    ],
  });
  trpc.mount(composeTrpcRouters("organization", [organizationTrpcTransport]), () =>
    createApiFixture<OrganizationApi>({ listVisibleOrganizations }),
  );

  const call = async () => {
    const request = new Request(
      `http://api.test${TrpcHost.path}/organization.getAll?input=${encodeURIComponent(
        JSON.stringify({}),
      )}`,
    );
    let context: ReturnType<TrpcHost["context"]> | undefined;
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext: () => (context ??= trpc.context({ request })),
    });

    return {
      body: (await response.json()) as {
        result?: unknown;
        error?: { data?: { code?: string } };
      },
      context: await context!,
    };
  };

  return { call, listVisibleOrganizations };
}

describe("organization.getAll over a verified session", () => {
  /** @scenario A verified browser session reaches the surfaces that render the person */
  it("asks the organization service for the verified person's organizations", async () => {
    const { call, listVisibleOrganizations } = served({
      session: { userId: "user_ana", name: "Ana", email: "ana@acme.com" },
    });

    const { body } = await call();

    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
    expect(listVisibleOrganizations).toHaveBeenCalledWith(
      { isDemo: false },
      { id: "user_ana", name: "Ana", email: "ana@acme.com" },
    );
  });

  /** @scenario An impersonated session reaches the surface as the impersonated person */
  it("asks for the impersonated person's organizations with the administrator beside them", async () => {
    const { call, listVisibleOrganizations } = served({
      session: {
        userId: "user_ana",
        name: "Ana",
        email: "ana@acme.com",
        impersonator: { id: "user_admin", name: "Root", email: "root@langwatch.ai" },
      },
    });

    const { body, context } = await call();

    expect(body.error).toBeUndefined();
    expect(listVisibleOrganizations).toHaveBeenCalledWith(
      { isDemo: false },
      { id: "user_ana", name: "Ana", email: "ana@acme.com" },
    );
    expect(context.session?.user.impersonator?.id).toBe("user_admin");
  });

  /** @scenario An anonymous caller stays refused by the same surface */
  it("refuses a request with no session and never asks the organization service", async () => {
    const { call, listVisibleOrganizations } = served({ session: null });

    const { body } = await call();

    expect(body.error?.data?.code).toBe("UNAUTHORIZED");
    expect(listVisibleOrganizations).not.toHaveBeenCalled();
  });
});
