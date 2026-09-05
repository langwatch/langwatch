/**
 * @vitest-environment jsdom
 *
 * The follow-along link the command line prints. It was printed on every share
 * and every permission ask and nothing read it, so it opened the project home
 * on whatever conversation the panel already had.
 *
 * @see specs/langy/langy-local-control.feature
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyConversationDeepLink } from "../hooks/useLangyConversationDeepLink";
import { carryLangyConversation } from "../logic/langyConversationDeepLink";

const setSearchParams = vi.fn();
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
  useSearchParams: () => [searchParams.current, setSearchParams] as const,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1" } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    langy: { detail: { useQuery: () => detailResult.current } },
  },
}));

vi.mock("../stores/langyStore", () => ({
  useLangyStore: { getState: () => ({ openPanel, selectConversation }) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.current = new URLSearchParams(
    "langyConversation=langyconv_1&tab=traces",
  );
});

/** What `setSearchParams` was asked to leave in the address bar. */
function strippedParams(): URLSearchParams {
  const update = setSearchParams.mock.calls[0]?.[0] as (
    prev: URLSearchParams,
  ) => URLSearchParams;
  return update(searchParams.current);
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

  describe("given a link to a conversation I cannot see", () => {
    /** @scenario "A link to a conversation I cannot see is refused silently" */
    it("switches nothing and still drops the parameter", async () => {
      detailResult.current = { data: null, isSuccess: true, isError: false };

      renderHook(() => useLangyConversationDeepLink());

      await waitFor(() => expect(setSearchParams).toHaveBeenCalled());
      expect(selectConversation).not.toHaveBeenCalled();
      expect(openPanel).not.toHaveBeenCalled();
      expect(strippedParams().has("langyConversation")).toBe(false);
    });
  });

  describe("while the read has not answered", () => {
    it("waits, rather than dropping the link on the floor", () => {
      detailResult.current = {
        data: undefined,
        isSuccess: false,
        isError: false,
      };

      renderHook(() => useLangyConversationDeepLink());

      expect(setSearchParams).not.toHaveBeenCalled();
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
      expect(
        carryLangyConversation({ destination: "/acme", search: "?org=acme" }),
      ).toBe("/acme");
      expect(
        carryLangyConversation({ destination: null, search: "" }),
      ).toBeNull();
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
