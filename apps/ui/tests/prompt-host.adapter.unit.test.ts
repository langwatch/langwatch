/**
 * What the Prompt host answers, and — the part worth a test — what it writes.
 *
 * Most of the port is a value object over readings the provider already made, so
 * the assertions below concentrate on the two methods that compose something.
 *
 * `openPlatformDrawer` is this family's single piece of platform vocabulary.
 * `traceV2Details` is the trace drawer, opened by most of the product, so the
 * chat's View Trace affordance names it and this adapter writes the address the
 * rest of the product already produces. It is not a REGISTERED drawer and
 * cannot be — its URL sync has to outlive `?drawer.open=` — so what answers the
 * address is the mount `ui-app-chrome` draws beside `CurrentDrawer`. Getting that
 * address wrong is silent in both directions: a missing `drawer.traceId` opens
 * an empty drawer, and a LEFTOVER key from a previous drawer opens the one the
 * reader looked at before this one. `openDrawer` clears every `drawer.*` key for
 * exactly that reason, and this adapter has to as well.
 *
 * `isReportedGlobally` is a recorded gap answered `false`, and it is asserted
 * rather than assumed: the day the global interceptors move to the transport,
 * this is the test that says the answer has to change.
 *
 * Spec: specs/prompts/prompt-studio-page.feature
 */

import { describe, expect, it, vi } from "vitest";
import { UiPromptHost } from "../src/features/prompt/behavior/prompt-host.adapter";
import { explainHandledError } from "@langwatch/handled-error/presentation";
import { promptPlaygroundChatAvailability } from "../src/features/prompt/model/prompt-playground-chat-availability";

function hostWith(query: Record<string, string | undefined>) {
  const setQuery = vi.fn();
  const navigate = vi.fn();
  const host = UiPromptHost.create(
    {
      scope: {
        organizationId: "org_1",
        teamId: "team_1",
        projectId: "project_1",
        projectSlug: "web-app",
        projectApiKey: "key_1",
      },
      hasPermission: (permission) => permission === "prompts:view",
      copyTargets: [],
      route: { params: {}, query },
      tabCapabilities: {
        storage: {
          length: 0,
          key: () => null,
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      },
      playgroundChat: promptPlaygroundChatAvailability(),
    },
    {
      setQuery,
      navigate,
      succeeded: vi.fn(),
      failed: vi.fn(),
      requestUpgrade: vi.fn(),
    },
  );
  return { host, setQuery, navigate };
}

describe("given the prompt host", () => {
  describe("when a screen addresses the trace drawer", () => {
    /** @scenario "Opening a trace from a playground turn addresses the trace drawer" */
    it("writes the drawer's name and its own parameters under the drawer prefix", () => {
      const { host, setQuery } = hostWith({});

      host.openPlatformDrawer({
        drawer: "traceV2Details",
        params: { traceId: "trace_1" },
      });

      expect(setQuery).toHaveBeenCalledWith({
        "drawer.open": "traceV2Details",
        "drawer.traceId": "trace_1",
      });
    });

    /** @scenario "Opening a trace from a playground turn addresses the trace drawer" */
    it("clears a stale drawer parameter left by whatever was open before", () => {
      const { host, setQuery } = hostWith({
        "drawer.open": "somethingElse",
        "drawer.datasetId": "dataset_1",
        project: "web-app",
      });

      host.openPlatformDrawer({
        drawer: "traceV2Details",
        params: { traceId: "trace_1" },
      });

      // `drawer.datasetId` is cleared by name rather than left to a whole-query
      // replace: `setQuery` merges, so anything not named here survives — which
      // is what keeps `?project=` and the span hand-off keys alone.
      //
      // Read off the recorded argument rather than through
      // `toHaveBeenCalledWith`: that matcher treats a property set to
      // `undefined` as absent, so an adapter that stopped clearing stale keys
      // altogether would still satisfy it. The clearing IS the behaviour here,
      // so the key has to be present and the value has to be `undefined`.
      const written = setQuery.mock.calls[0]?.[0] as Record<string, string | undefined>;
      expect(Object.keys(written).sort()).toEqual([
        "drawer.datasetId",
        "drawer.open",
        "drawer.traceId",
      ]);
      expect(written["drawer.datasetId"]).toBeUndefined();
      expect(written["drawer.open"]).toBe("traceV2Details");
      expect(written["drawer.traceId"]).toBe("trace_1");
      expect(written).not.toHaveProperty("project");
    });
  });

  describe("when a screen asks whether a failure was already shown", () => {
    it("answers no, because nothing above a package-served screen reports one", () => {
      const { host } = hostWith({});

      expect(host.isReportedGlobally(new Error("refused"))).toBe(false);
    });
  });

  /**
   * The Conversation tab asks whether there is a chat runtime to talk to, and
   * on this deployment there is not: `apps/api` declares `/api/copilotkit`
   * absent at boot, so the chat had nowhere to post and rendered anyway.
   *
   * The words are asserted to come from the code-keyed presentation registry
   * rather than from a sentence written at the seam — that is the whole reason
   * the answer carries copy at all, and a hand-written string here would pass a
   * looser test while putting unregistered prose in front of a customer.
   */
  describe("when a screen asks whether the playground chat is available", () => {
    it("says it is not, in the registry's own words", () => {
      const { host } = hostWith({});
      const answer = host.playgroundChat();

      const registered = explainHandledError({
        code: "prompt_playground_chat_unavailable",
        meta: {},
        httpStatus: 501,
        fault: "platform",
        retryable: false,
        tips: [],
        docsUrl: void 0,
        traceId: void 0,
        reasons: [],
      });

      // Copy was written for this code, rather than the degraded form that
      // humanises the slug — which is what a missing registry entry would give
      // the reader, and it reads as "Prompt playground chat unavailable".
      expect(registered.isRegistered).toBe(true);
      expect(answer).toEqual({
        available: false,
        title: registered.title,
        description: registered.description,
      });
    });
  });

  describe("when a screen asks what the reader may do", () => {
    it("answers the grant it was handed and nothing adjacent to it", () => {
      const { host } = hostWith({});

      expect(host.hasPermission("prompts:view")).toBe(true);
      expect(host.hasPermission("prompts:create")).toBe(false);
    });
  });
});
