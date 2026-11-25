import { carryLangyConversation } from "@langwatch/langy-contract";
/**
 * @vitest-environment jsdom
 *
 * The follow-along link the command line prints must open the conversation it names, not
 * whatever the panel already had.
 * @see specs/langy/langy-local-control.feature
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLangyConversationDeepLink } from "../../../../../behavior/use-langy-conversation-deep-link.ts";

const navigate = vi.fn();
const hash = { current: "" };
const searchParams = { current: new URLSearchParams() };
const detailResult = {
  current: {
    data: undefined as unknown,
    isSuccess: false,
    isError: false,
  },
};
const openPanel = vi.fn();
const selectConversation = vi.fn();

vi.mock("react-router", () => ({
  useLocation: () => ({
    pathname: "/my-project/traces",
    search: `?${searchParams.current.toString()}`,
    hash: hash.current,
  }),
  useNavigate: () => navigate,
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1" } }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    langy: { detail: { useQuery: () => detailResult.current } },
  },
}));

vi.mock("../../../../../behavior/langy.store.ts", () => ({
  useLangyStore: { getState: () => ({ openPanel, selectConversation }) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.current = new URLSearchParams("langyConversation=langyconv_1&tab=traces");
  hash.current = "";
});

/** What the hook was asked to leave in the address bar. */
function strippedParams(): URLSearchParams {
  const to = navigate.mock.calls[0]?.[0] as { search: string };
  return new URLSearchParams(to.search);
}

describe("useLangyConversationDeepLink", () => {
  describe("given a link to a conversation I can see", () => {
    /** @scenario "The follow-along link opens the panel on that conversation" */
    it("opens the panel on it and drops the parameter", async () => {
      detailResult.current = {
        data: { id: "langyconv_1" },
        isSuccess: true,
        isError: false,
      };

      renderHook(() => useLangyConversationDeepLink());

      await waitFor(() => expect(selectConversation).toHaveBeenCalled());
      expect(openPanel).toHaveBeenCalled();
      expect(selectConversation).toHaveBeenCalledWith("langyconv_1");
      expect(strippedParams().has("langyConversation")).toBe(false);
      expect(strippedParams().get("tab")).toBe("traces");
    });
  });

  describe("given a question link beside the conversation link", () => {
    it("leaves both to the question link, which opens a new conversation", () => {
      searchParams.current = new URLSearchParams("langyConversation=langyconv_1&langyPrompt=hi");
      detailResult.current = { data: { id: "langyconv_1" }, isSuccess: true, isError: false };

      renderHook(() => useLangyConversationDeepLink());

      expect(selectConversation).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("given the Trace Explorer's query in the hash", () => {
    it("keeps the hash when it drops the parameter", async () => {
      hash.current = "#all-traces?q=trace.attribute.laze.agent.id%3Aagt_1";
      detailResult.current = { data: { id: "langyconv_1" }, isSuccess: true, isError: false };

      renderHook(() => useLangyConversationDeepLink());

      await waitFor(() => expect(navigate).toHaveBeenCalled());
      expect(navigate.mock.calls[0]?.[0]).toMatchObject({
        pathname: "/my-project/traces",
        hash: "#all-traces?q=trace.attribute.laze.agent.id%3Aagt_1",
      });
    });
  });

  describe("given a blank question beside the conversation link", () => {
    /** @scenario "A blank question beside a conversation link still opens that conversation" */
    it("opens the named conversation", async () => {
      searchParams.current = new URLSearchParams(
        "langyConversation=langyconv_1&langy=open&langyPrompt=",
      );
      detailResult.current = { data: { id: "langyconv_1" }, isSuccess: true, isError: false };

      renderHook(() => useLangyConversationDeepLink());

      await waitFor(() => expect(selectConversation).toHaveBeenCalledWith("langyconv_1"));
    });
  });

  describe("given a link to a conversation I cannot see", () => {
    /** @scenario "A link to a conversation I cannot see is refused silently" */
    it("switches nothing and still drops the parameter", async () => {
      detailResult.current = { data: null, isSuccess: true, isError: false };

      renderHook(() => useLangyConversationDeepLink());

      await waitFor(() => expect(navigate).toHaveBeenCalled());
      expect(selectConversation).not.toHaveBeenCalled();
      expect(openPanel).not.toHaveBeenCalled();
      expect(strippedParams().has("langyConversation")).toBe(false);
    });
  });

  describe("given the read has not answered yet", () => {
    it("waits, rather than dropping the link on the floor", () => {
      detailResult.current = {
        data: undefined,
        isSuccess: false,
        isError: false,
      };

      renderHook(() => useLangyConversationDeepLink());

      expect(navigate).not.toHaveBeenCalled();
      expect(selectConversation).not.toHaveBeenCalled();
    });
  });
});

describe("carryLangyConversation", () => {
  describe("given the site root resolving to a home page", () => {
    /** @scenario "The conversation parameter survives the home redirect" */
    it("carries the parameter onto the destination", () => {
      expect(
        carryLangyConversation({
          destination: "/acme",
          search: "?langyConversation=langyconv_1",
        }),
      ).toBe("/acme?langyConversation=langyconv_1");
    });
  });

  describe("given no such parameter", () => {
    it("leaves the destination exactly as it was", () => {
      expect(carryLangyConversation({ destination: "/acme", search: "?org=acme" })).toBe("/acme");
    });
  });

  describe("given a destination that already carries it", () => {
    it("does not add it twice", () => {
      expect(
        carryLangyConversation({
          destination: "/acme?langyConversation=langyconv_2",
          search: "?langyConversation=langyconv_1",
        }),
      ).toBe("/acme?langyConversation=langyconv_2");
    });
  });
});
