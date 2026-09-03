/**
 * @vitest-environment jsdom
 *
 * The flow-callback registry's close policy: a flow's registration ends with
 * the drawer it ran through, and a mounted component's does not.
 *
 * Spec: specs/features/drawer-flow-callbacks.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFlowCallbacks,
  getAllFlowCallbacks,
  getFlowCallbacks,
  setFlowCallbacks,
} from "../use-drawer";

beforeEach(() => {
  clearFlowCallbacks();
  // A kept registration survives clearFlowCallbacks by design, so the previous
  // test's owner takes its own registration back the way a component does.
  setFlowCallbacks("agentTestingCaseEditor", {});
  clearFlowCallbacks();
});

describe("given several flows registered callbacks", () => {
  describe("when the drawer is closed", () => {
    /** @scenario "Closing a drawer clears the callbacks of the flows" */
    it("leaves neither registration", () => {
      setFlowCallbacks("promptList", { onSelect: vi.fn() });
      setFlowCallbacks("agentList", { onSelect: vi.fn() });

      expect(Object.keys(getAllFlowCallbacks())).toHaveLength(2);

      clearFlowCallbacks();

      expect(getAllFlowCallbacks()).toEqual({});
    });
  });
});

describe("given a mounted component holds the registration", () => {
  describe("when the drawer is closed", () => {
    /** @scenario "A registration a mounted component holds survives a close" */
    it("keeps the one registered with keepOnClose and drops the rest", () => {
      const onSaved = vi.fn();
      setFlowCallbacks("agentTestingCaseEditor", { onSaved }, { keepOnClose: true });
      setFlowCallbacks("promptList", { onSelect: vi.fn() });

      clearFlowCallbacks();

      expect(Object.keys(getAllFlowCallbacks())).toEqual(["agentTestingCaseEditor"]);
      expect(getFlowCallbacks("agentTestingCaseEditor")?.onSaved).toBe(onSaved);
    });
  });

  describe("when the component registers an empty set for its drawer", () => {
    /** @scenario "A component takes its own registration back" */
    it("drops it on the next close", () => {
      setFlowCallbacks("agentTestingCaseEditor", { onSaved: vi.fn() }, { keepOnClose: true });
      setFlowCallbacks("agentTestingCaseEditor", {});

      clearFlowCallbacks();

      expect(getAllFlowCallbacks()).toEqual({});
    });
  });
});
