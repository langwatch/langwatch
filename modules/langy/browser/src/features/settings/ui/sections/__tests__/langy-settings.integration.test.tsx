/**
 * @vitest-environment jsdom
 * Settings › Project › Langy over the real model narrowing, with the tRPC hooks and host faked.
 * Spec: specs/langy/langy-model-allowlist.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LangyHostApi,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../model/langy-host.ts";

// jsdom has no Element.scrollTo nor ResizeObserver, which the select's popper calls.
Element.prototype.scrollTo = () => undefined;
if (!window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

const state = vi.hoisted(() => ({
  saved: null as string[] | null,
  savedReadFails: false,
  refetch: vi.fn(),
  defaultModel: "openai/gpt-5" as string | null,
  mutate: vi.fn(),
}));

vi.mock("../../../../langy/behavior/use-show-langy.ts", () => ({
  useLangyVisibility: () => ({ show: true, isResolving: false }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({ langy: { modelsAllowed: { setData: vi.fn() } } }),
    langy: {
      modelsAllowed: {
        useQuery: () =>
          state.savedReadFails
            ? { data: undefined, isSuccess: false, isError: true, refetch: state.refetch }
            : { data: { modelsAllowed: state.saved }, isSuccess: true, isError: false },
      },
      setModelsAllowed: { useMutation: () => ({ mutate: state.mutate, isPending: false }) },
    },
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({ data: { model: state.defaultModel }, isLoading: false }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: [{ provider: "openai", enabled: true, customModels: null }],
          isLoading: false,
        }),
      },
    },
  },
}));

class FakeLangyHost extends LangyHostApi {
  constructor(private readonly canManage: boolean) {
    super();
  }
  project(): LangyHostProject | undefined {
    return { id: "project_1", slug: "demo", name: "Demo" };
  }
  organization(): LangyHostOrganization | undefined {
    return { id: "org_1" };
  }
  team(): LangyHostTeam | undefined {
    return { id: "team_1" };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user_1" };
  }
  hasOrganizationPermission() {
    return false;
  }
  hasPermission(permission: string) {
    return permission === "langy:manage" ? this.canManage : true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/settings/langy" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}

import LangySettingsScreen from "../langy-settings.screen.tsx";

function renderScreen({ canManage = true } = {}) {
  return render(
    <DesignSystemProvider>
      <LangyHostProvider value={new FakeLangyHost(canManage)}>
        <LangySettingsScreen />
      </LangyHostProvider>
    </DesignSystemProvider>,
  );
}

/** The drawn list; a multiple select's hidden native `<select>` is a listbox too. */
const listbox = () =>
  screen.getAllByRole("listbox", { hidden: true }).find((node) => node.tagName !== "SELECT")!;
const offered = () =>
  within(listbox())
    .getAllByRole("option", { hidden: true })
    .map((option) => option.getAttribute("data-value") ?? "");

beforeEach(() => {
  state.saved = null;
  state.savedReadFails = false;
  state.refetch.mockReset();
  state.defaultModel = "openai/gpt-5";
  state.mutate.mockReset();
});

afterEach(cleanup);

describe("<LangySettingsScreen/>", () => {
  describe("given only OpenAI is connected", () => {
    /** @scenario "The settings page offers only the models the project can serve" */
    it("offers OpenAI's chat models and says an empty list allows every model", () => {
      renderScreen();

      expect(offered().length).toBeGreaterThan(0);
      expect(offered().every((value) => value.startsWith("openai/"))).toBe(true);
      expect(screen.getByText(/Leave it empty to let Langy use every model/)).not.toBeNull();
      expect(screen.getByText("Every model your providers serve")).not.toBeNull();
    });
  });

  describe("when a project admin picks a list without Langy's default model", () => {
    /** @scenario "The settings page warns when Langy's default model is outside the list" */
    it("warns that runs on the default model are refused, and saves the pick", async () => {
      renderScreen();
      const mini = offered().find((value) => value !== "openai/gpt-5")!;
      const user = userEvent.setup();

      expect(screen.queryByTestId("langy-default-model-outside-list")).toBeNull();
      await user.click(screen.getByRole("combobox", { name: "Models Langy may use" }));
      const row = within(listbox())
        .getAllByRole("option", { hidden: true })
        .find((option) => option.getAttribute("data-value") === mini)!;
      await user.click(row);

      const warning = screen.getByTestId("langy-default-model-outside-list");
      expect(warning.textContent).toContain("Chats switch to an allowed model");
      expect(warning.textContent).toContain("openai/gpt-5");
      expect(warning.textContent).toContain("is refused");

      await user.click(screen.getByRole("button", { name: "Save changes" }));
      expect(state.mutate).toHaveBeenCalledWith({ projectId: "project_1", modelsAllowed: [mini] });
    });
  });

  describe("given the saved list cannot be read", () => {
    /** @scenario "The page offers no save until the current list has loaded" */
    it("says so, offers a retry and no way to save", async () => {
      state.savedReadFails = true;
      renderScreen();

      const notice = screen.getByTestId("langy-models-load-error");
      expect(notice.textContent).toContain("Couldn't load Langy's models");
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
      expect(screen.queryByRole("combobox", { name: "Models Langy may use" })).toBeNull();

      await userEvent.setup().click(within(notice).getByRole("button", { name: "Try again" }));
      expect(state.refetch).toHaveBeenCalledOnce();
      expect(state.mutate).not.toHaveBeenCalled();
    });
  });

  describe("given a member without langy:manage", () => {
    /** @scenario "A member without manage rights sees the list read-only" */
    it("shows the saved models with no way to change them", () => {
      state.saved = ["openai/gpt-5"];
      renderScreen({ canManage: false });

      const picker = screen.getByRole("combobox", { name: "Models Langy may use" });
      expect(picker.hasAttribute("disabled") || picker.getAttribute("data-disabled") !== null).toBe(
        true,
      );
      expect(within(picker).getByText(/gpt-5/)).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
      expect(screen.getByText(/Only project admins can change/)).not.toBeNull();
    });
  });
});
