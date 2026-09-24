import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { bindRestMiddleware, createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import {
  GuidedOnboardingPathUnknownError,
  type OnboardingApi,
} from "@langwatch/onboarding-contract";
import { describe, expect, it, vi } from "vitest";

import { onboardingRest, onboardingRestCredential } from "../onboarding.rest.ts";

const PROJECT = "project-1";
const ORGANIZATION = "organization-1";

/** A handled error carries its own stable `code` and `httpStatus`; this test asks for both. */
type CarriesHandledShape = { code: string; httpStatus: number };
function isHandledShape(error: unknown): error is CarriesHandledShape {
  return typeof error === "object" && error !== null && "code" in error && "httpStatus" in error;
}

const renderHandled: RestErrorHandler = (error, c) => {
  if (isHandledShape(error)) {
    return c.json({ error: error.code }, error.httpStatus as 403);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

type Credential = { organizationId: string; userId: string | null };

function mount(options: { credential?: Credential; onboarding?: Partial<OnboardingApi> } = {}) {
  const credential =
    options.credential === undefined
      ? { organizationId: ORGANIZATION, userId: "user-1" }
      : options.credential;
  const app = createApiFixture<OnboardingApi>(options.onboarding ?? {});
  const hono = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: credential.userId ? { type: "user", id: credential.userId } : null,
        scope: { tier: "project", id: PROJECT },
      }),
    },
  } as never).mount(onboardingRest.router(), {
    app: () => app,
    credential: "project",
    onError: renderHandled,
    facts: [bindRestMiddleware(onboardingRestCredential, () => credential)],
  });

  const send = (method: string, path: string) =>
    hono.fetch(new Request(`http://api.test${path}`, { method }));

  return { send };
}

describe("given a project API key bound to a user", () => {
  describe("when it reads the guided onboarding state", () => {
    /** @scenario "A bound key reads the organization's guided onboarding state" */
    it("calls the application with the resolved organization and user", async () => {
      const getGuidedState = vi.fn(async () => ({
        currentPath: null,
        paths: [],
        completedPaths: [],
        provider: null,
        variant: null,
      }));
      const { send } = mount({ onboarding: { getGuidedState: getGuidedState as never } });

      const response = await send("GET", "/api/onboarding/guided");

      expect(response.status).toBe(200);
      expect(getGuidedState).toHaveBeenCalledWith({
        organizationId: ORGANIZATION,
        userId: "user-1",
      });
    });
  });
});

describe("given a project whose organization recorded llmops and gateway", () => {
  describe("when the guided state is read with that project's credential", () => {
    /** @scenario "the REST route reads the guided state of the project's organization" */
    it("answers the state with both paths", async () => {
      const getGuidedState = vi.fn(async () => ({
        paths: ["llmops", "gateway"],
        currentPath: "llmops",
        donePaths: [],
      }));
      const { send } = mount({ onboarding: { getGuidedState: getGuidedState as never } });

      const response = await send("GET", "/api/onboarding/guided");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        paths: ["llmops", "gateway"],
        currentPath: "llmops",
        donePaths: [],
      });
    });
  });

  describe("when the llmops path is completed with that project's credential", () => {
    /** @scenario "the REST route completes a path for the project's organization" */
    it("completes it on the project's organization and answers llmops among the done paths", async () => {
      const completePath = vi.fn(async () => ({
        paths: ["llmops", "gateway"],
        donePaths: ["llmops"],
      }));
      const { send } = mount({ onboarding: { completePath: completePath as never } });

      const response = await send("POST", "/api/onboarding/guided/paths/llmops/complete");

      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(body).toMatchObject({ donePaths: ["llmops"] });
      expect(body).not.toHaveProperty("currentPath");
      expect(completePath).toHaveBeenCalledWith({
        organizationId: ORGANIZATION,
        userId: "user-1",
        path: "llmops",
      });
    });

    it("refuses a path the product does not know with the named code", async () => {
      const completePath = vi.fn(async ({ path }: { path: string }) => {
        throw new GuidedOnboardingPathUnknownError(path);
      });
      const { send } = mount({ onboarding: { completePath: completePath as never } });

      const response = await send("POST", "/api/onboarding/guided/paths/billing/complete");

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: "guided_onboarding_path_unknown",
      });
    });
  });
});

describe("given a project API key that names no user", () => {
  describe("when it reads or completes a guided onboarding path", () => {
    /** @scenario "An unbound key is refused rather than read as nobody's state" */
    it("refuses with a handled 403 naming permission_denied", async () => {
      const getGuidedState = vi.fn();
      const completePath = vi.fn();
      const { send } = mount({
        credential: { organizationId: ORGANIZATION, userId: null },
        onboarding: {
          getGuidedState: getGuidedState as never,
          completePath: completePath as never,
        },
      });

      const response = await send("GET", "/api/onboarding/guided");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: "permission_denied" });
      expect(getGuidedState).not.toHaveBeenCalled();
      expect(completePath).not.toHaveBeenCalled();
    });
  });

  describe("given the published API document", () => {
    it("leaves both guided routes out, because only Langy's CLI calls them", () => {
      const hidden = onboardingRest.router().routes.map((route) => route.docs?.hide);

      expect(hidden).toEqual([true, true]);
    });
  });
});
