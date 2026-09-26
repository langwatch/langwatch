/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTourActions,
  useRegisterTourActions,
  useTourRegistry,
} from "../tourRegistry";

describe("tour registry", () => {
  beforeEach(() => useTourRegistry.setState({ actions: {} }));

  describe("when a page registers an action", () => {
    /** @scenario a page registers tour actions on mount and removes them on unmount */
    it("lends it while mounted and takes it back on unmount", () => {
      const openVirtualKeyCreate = vi.fn();
      const actions = { openVirtualKeyCreate };
      const { unmount } = renderHook(() => useRegisterTourActions(actions));
      expect(getTourActions().openVirtualKeyCreate).toBe(openVirtualKeyCreate);
      unmount();
      expect(getTourActions().openVirtualKeyCreate).toBeUndefined();
    });

    it("keeps another page's actions when one unmounts", () => {
      const expandGroup = vi.fn();
      const unregisterGroups = useTourRegistry
        .getState()
        .register({ expandGroup });
      const unregisterKeys = useTourRegistry
        .getState()
        .register({ openVirtualKeyCreate: vi.fn() });
      unregisterKeys();
      expect(getTourActions().expandGroup).toBe(expandGroup);
      expect(getTourActions().openVirtualKeyCreate).toBeUndefined();
      unregisterGroups();
      expect(getTourActions()).toEqual({});
    });
  });
});
