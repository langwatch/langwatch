/**
 * @vitest-environment jsdom
 *
 * A home pin saved as /me, before the personal home moved to /coding-agents.
 * Spec: specs/navigation/coding-agents-url-move.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const stateData = {
  data: { lastHomePath: "/me" as string | null, firstProjectSlug: null as string | null },
  isLoading: false,
};
const resolverData = {
  data: { persona: "personal_only", firstProjectSlug: null as string | null },
  isLoading: false,
};

vi.mock("../../../behavior/personal-workspace-feedback.ts", () => ({
  useShowErrorToast: () => () => {},
}));

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  api: {
    user: {
      homePagePickerState: { useQuery: () => stateData },
      setLastHomePath: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
    governance: { resolveHome: { useQuery: () => resolverData } },
    useUtils: () => ({
      user: { homePagePickerState: { invalidate: () => {} } },
      governance: { resolveHome: { invalidate: () => {} } },
    }),
  },
}));

import { HomePagePicker } from "../home-page-picker.tsx";

afterEach(cleanup);

const CHECKED_ITEM = '[data-scope="radio-group"][data-part="item"][data-state="checked"]';

describe("given the user's home pin was saved as /me", () => {
  describe("when the picker reads the pin", () => {
    /** @scenario A home page pin saved as /me still reads as Personal home */
    it("selects the Personal home option, not Auto", () => {
      const { container } = render(
        <DesignSystemProvider forcedTheme="light">
          <HomePagePicker organizationId="org_1" />
        </DesignSystemProvider>,
      );

      const checked = container.querySelectorAll(CHECKED_ITEM);
      expect(checked).toHaveLength(1);
      expect(checked[0]?.querySelector("input")?.value).toBe("personal");
    });
  });
});
