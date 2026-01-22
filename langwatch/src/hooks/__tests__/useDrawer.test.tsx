/**
 * @vitest-environment jsdom
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  clearDrawerStack,
  clearFlowCallbacks,
  getAllFlowCallbacks,
  getComplexProps,
  getDrawerStack,
  getFlowCallbacks,
  setFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "../useDrawer";

// Mock next/router
const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockQuery: Record<string, string> = {};

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockQuery,
    asPath:
      Object.keys(mockQuery).length > 0
        ? "?" + new URLSearchParams(mockQuery).toString()
        : "/",
    push: mockPush,
    replace: mockReplace,
  }),
}));

describe("useDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = {};
    clearDrawerStack();
    clearFlowCallbacks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("openDrawer", () => {
    it("opens a drawer with type-safe props", () => {
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.openDrawer("promptList");
      });

      expect(mockPush).toHaveBeenCalled();
      const pushCall = mockPush.mock.calls[0]?.[0] as string;
      expect(pushCall).toContain("drawer.open=promptList");
    });

    it("accepts drawer-specific props", () => {
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.openDrawer("promptEditor", { promptId: "test-id" });
      });

      expect(mockPush).toHaveBeenCalled();
      const pushCall = mockPush.mock.calls[0]?.[0] as string;
      expect(pushCall).toContain("drawer.open=promptEditor");
      expect(pushCall).toContain("drawer.promptId=test-id");
    });

    it("accepts urlParams for context data", () => {
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.openDrawer("promptEditor", {
          promptId: "test-id",
          urlParams: { targetId: "runner-123" },
        });
      });

      expect(mockPush).toHaveBeenCalled();
      const pushCall = mockPush.mock.calls[0]?.[0] as string;
      expect(pushCall).toContain("drawer.promptId=test-id");
      expect(pushCall).toContain("drawer.targetId=runner-123");
    });

    it("uses replace when replace option is true", () => {
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.openDrawer("promptList", undefined, { replace: true });
      });

      expect(mockReplace).toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("builds drawer stack on navigation", () => {
      mockQuery = { "drawer.open": "targetTypeSelector" };
      const { result } = renderHook(() => useDrawer());

      // First drawer opens from URL - stack is empty initially
      expect(getDrawerStack()).toHaveLength(0);

      act(() => {
        result.current.openDrawer("promptList");
      });

      // Stack should have 2 entries: the current drawer from URL (targetTypeSelector)
      // was added first, then promptList was pushed
      // This ensures we can go back to the original drawer
      expect(getDrawerStack()).toHaveLength(2);
      expect(getDrawerStack()[0]?.drawer).toBe("targetTypeSelector");
      expect(getDrawerStack()[1]?.drawer).toBe("promptList");

      // Simulate being on promptList now
      mockQuery = { "drawer.open": "promptList" };
      const { result: result2 } = renderHook(() => useDrawer());

      act(() => {
        result2.current.openDrawer("promptEditor", { promptId: "abc" });
      });

      expect(getDrawerStack()).toHaveLength(3);
    });
  });

  describe("closeDrawer", () => {
    it("clears the drawer from URL", () => {
      mockQuery = { "drawer.open": "promptList" };
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.closeDrawer();
      });

      expect(mockPush).toHaveBeenCalled();
      const pushCall = mockPush.mock.calls[0]?.[0] as string;
      expect(pushCall).not.toContain("drawer");
    });

    it("clears the drawer stack", () => {
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.openDrawer("promptList");
        result.current.openDrawer("promptEditor");
      });

      expect(getDrawerStack().length).toBeGreaterThan(0);

      act(() => {
        result.current.closeDrawer();
      });

      expect(getDrawerStack()).toHaveLength(0);
    });

    it("clears flow callbacks", () => {
      const { result } = renderHook(() => useDrawer());

      act(() => {
        setFlowCallbacks("promptList", { onSelect: vi.fn() });
        result.current.openDrawer("promptList");
      });

      expect(getAllFlowCallbacks()).toHaveProperty("promptList");

      act(() => {
        result.current.closeDrawer();
      });

      expect(getAllFlowCallbacks()).toEqual({});
    });
  });

  describe("goBack", () => {
    it("closes drawer when at root of stack", () => {
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.openDrawer("promptList");
      });

      act(() => {
        result.current.goBack();
      });

      expect(mockPush).toHaveBeenCalled();
      // Should close the drawer entirely
    });

    it("navigates to previous drawer when stack has multiple entries", () => {
      // Open first drawer
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.openDrawer("targetTypeSelector");
      });

      expect(getDrawerStack()).toHaveLength(1);

      // Simulate URL updated to targetTypeSelector
      mockQuery = { "drawer.open": "targetTypeSelector" };

      // Open second drawer from a fresh hook (simulating new component rendering)
      const { result: result2 } = renderHook(() => useDrawer());
      act(() => {
        result2.current.openDrawer("promptList");
      });

      expect(getDrawerStack()).toHaveLength(2);

      // Go back
      act(() => {
        result2.current.goBack();
      });

      expect(getDrawerStack()).toHaveLength(1);
      expect(mockReplace).toHaveBeenCalled();
      const replaceCall = mockReplace.mock.calls[0]?.[0] as string;
      expect(replaceCall).toContain("drawer.open=targetTypeSelector");
    });
  });

  describe("drawerOpen", () => {
    it("returns true when drawer is open", () => {
      mockQuery = { "drawer.open": "promptList" };
      const { result } = renderHook(() => useDrawer());

      expect(result.current.drawerOpen("promptList")).toBe(true);
      expect(result.current.drawerOpen("promptEditor")).toBe(false);
    });

    it("returns false when no drawer is open", () => {
      mockQuery = {};
      const { result } = renderHook(() => useDrawer());

      expect(result.current.drawerOpen("promptList")).toBe(false);
    });
  });

  describe("canGoBack", () => {
    it("returns false when stack has one or no entries", () => {
      const { result } = renderHook(() => useDrawer());

      expect(result.current.canGoBack).toBe(false);

      act(() => {
        result.current.openDrawer("promptList");
      });

      expect(result.current.canGoBack).toBe(false);
    });

    it("returns true when stack has multiple entries", () => {
      // First, open the first drawer
      const { result } = renderHook(() => useDrawer());

      act(() => {
        result.current.openDrawer("targetTypeSelector");
      });

      // Now simulate that targetTypeSelector is open in the URL
      mockQuery = { "drawer.open": "targetTypeSelector" };

      // Open a second drawer (which will add to stack since currentDrawer exists)
      const { result: result2 } = renderHook(() => useDrawer());
      act(() => {
        result2.current.openDrawer("promptList");
      });

      // Stack should now have 2 entries
      expect(getDrawerStack()).toHaveLength(2);

      // Render a new hook instance to get the updated canGoBack value
      // (canGoBack is computed at render time from the module-level stack)
      const { result: result3 } = renderHook(() => useDrawer());
      expect(result3.current.canGoBack).toBe(true);
    });
  });
});

describe("useDrawerParams", () => {
  beforeEach(() => {
    mockQuery = {};
  });

  it("returns empty object when no drawer params", () => {
    const { result } = renderHook(() => useDrawerParams());
    expect(result.current).toEqual({});
  });

  it("extracts drawer params from query", () => {
    mockQuery = {
      "drawer.open": "promptEditor",
      "drawer.promptId": "test-123",
      "drawer.targetId": "runner-456",
      otherParam: "ignored",
    };

    const { result } = renderHook(() => useDrawerParams());

    expect(result.current).toEqual({
      promptId: "test-123",
      targetId: "runner-456",
    });
    expect(result.current).not.toHaveProperty("open");
    expect(result.current).not.toHaveProperty("otherParam");
  });
});

describe("Flow Callbacks", () => {
  beforeEach(() => {
    clearFlowCallbacks();
  });

  describe("setFlowCallbacks", () => {
    it("sets callbacks for a specific drawer type", () => {
      const onSelect = vi.fn();
      setFlowCallbacks("promptList", { onSelect });

      const callbacks = getFlowCallbacks("promptList");
      expect(callbacks).toHaveProperty("onSelect");
      expect(callbacks?.onSelect).toBe(onSelect);
    });

    it("preserves callbacks for other drawers", () => {
      const onSelectPrompt = vi.fn();
      const onSelectAgent = vi.fn();

      setFlowCallbacks("promptList", { onSelect: onSelectPrompt });
      setFlowCallbacks("agentList", { onSelect: onSelectAgent });

      expect(getFlowCallbacks("promptList")?.onSelect).toBe(onSelectPrompt);
      expect(getFlowCallbacks("agentList")?.onSelect).toBe(onSelectAgent);
    });

    it("overwrites callbacks for the same drawer", () => {
      const onSelect1 = vi.fn();
      const onSelect2 = vi.fn();

      setFlowCallbacks("promptList", { onSelect: onSelect1 });
      setFlowCallbacks("promptList", { onSelect: onSelect2 });

      expect(getFlowCallbacks("promptList")?.onSelect).toBe(onSelect2);
    });
  });

  describe("getFlowCallbacks", () => {
    it("returns undefined for unregistered drawers", () => {
      expect(getFlowCallbacks("promptList")).toBeUndefined();
    });

    it("returns callbacks for registered drawers", () => {
      const onSelect = vi.fn();
      setFlowCallbacks("promptList", { onSelect });

      const callbacks = getFlowCallbacks("promptList");
      expect(callbacks).toBeDefined();
      expect(callbacks?.onSelect).toBe(onSelect);
    });
  });

  describe("clearFlowCallbacks", () => {
    it("clears all flow callbacks", () => {
      setFlowCallbacks("promptList", { onSelect: vi.fn() });
      setFlowCallbacks("agentList", { onSelect: vi.fn() });

      expect(Object.keys(getAllFlowCallbacks())).toHaveLength(2);

      clearFlowCallbacks();

      expect(getAllFlowCallbacks()).toEqual({});
    });
  });

  describe("callbacks persist across drawer navigation", () => {
    it("callbacks survive navigation to child drawer", () => {
      const { result } = renderHook(() => useDrawer());
      const onSelect = vi.fn();

      // Set callbacks before opening drawer flow
      act(() => {
        setFlowCallbacks("promptList", { onSelect });
        result.current.openDrawer("targetTypeSelector");
      });

      // Simulate navigating to child drawer
      mockQuery = { "drawer.open": "targetTypeSelector" };

      act(() => {
        result.current.openDrawer("promptList");
      });

      // Callbacks should still be available
      const callbacks = getFlowCallbacks("promptList");
      expect(callbacks?.onSelect).toBe(onSelect);
    });

    it("callbacks are cleared when drawer is closed", () => {
      const { result } = renderHook(() => useDrawer());

      act(() => {
        setFlowCallbacks("promptList", { onSelect: vi.fn() });
        result.current.openDrawer("promptList");
      });

      expect(getFlowCallbacks("promptList")).toBeDefined();

      act(() => {
        result.current.closeDrawer();
      });

      expect(getFlowCallbacks("promptList")).toBeUndefined();
    });
  });
});

describe("Complex Props (backward compatibility)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = {};
    clearDrawerStack();
    clearFlowCallbacks();
  });

  it("extracts function props into complexProps", () => {
    const { result } = renderHook(() => useDrawer());
    const onSave = vi.fn();

    act(() => {
      result.current.openDrawer("promptEditor", { onSave });
    });

    const complexProps = getComplexProps();
    expect(complexProps).toHaveProperty("onSave");
    expect(complexProps.onSave).toBe(onSave);
  });

  it("extracts object props into complexProps and excludes them from URL", () => {
    const { result } = renderHook(() => useDrawer());
    const availableSources = [
      {
        id: "ds1",
        name: "Dataset 1",
        type: "dataset",
        fields: [{ name: "input", type: "string" }],
      },
    ];
    const inputMappings = {
      input: { type: "source", sourceId: "ds1", path: ["input"] },
    };

    act(() => {
      result.current.openDrawer("promptEditor", {
        promptId: "test-123",
        availableSources,
        inputMappings,
      } as never); // Use never to bypass type checking for test props
    });

    // Objects should be in complexProps
    const complexProps = getComplexProps();
    expect(complexProps).toHaveProperty("availableSources");
    expect(complexProps).toHaveProperty("inputMappings");
    expect(complexProps.availableSources).toBe(availableSources);
    expect(complexProps.inputMappings).toBe(inputMappings);

    // URL should NOT contain [object Object]
    expect(mockPush).toHaveBeenCalled();
    const pushCall = mockPush.mock.calls[0]?.[0] as string;
    expect(pushCall).not.toContain("[object");
    expect(pushCall).not.toContain("availableSources");
    expect(pushCall).not.toContain("inputMappings");
    // But should contain serializable props
    expect(pushCall).toContain("drawer.promptId=test-123");
  });

  it("handles arrays in props by storing in complexProps", () => {
    const { result } = renderHook(() => useDrawer());
    const messages = [{ role: "user", content: "Hello" }];

    act(() => {
      result.current.openDrawer("promptEditor", {
        promptId: "test-456",
        initialLocalConfig: { messages },
      } as never);
    });

    // Objects (including those containing arrays) should be in complexProps
    const complexProps = getComplexProps();
    expect(complexProps).toHaveProperty("initialLocalConfig");

    // URL should NOT contain corrupted array string
    const pushCall = mockPush.mock.calls[0]?.[0] as string;
    expect(pushCall).not.toContain("[object");
    expect(pushCall).toContain("drawer.promptId=test-456");
  });

  it("complexProps are replaced on each openDrawer", () => {
    const { result } = renderHook(() => useDrawer());
    const onSave1 = vi.fn();
    const onSave2 = vi.fn();

    act(() => {
      result.current.openDrawer("promptEditor", { onSave: onSave1 });
    });

    expect(getComplexProps().onSave).toBe(onSave1);

    mockQuery = { "drawer.open": "promptEditor" };

    act(() => {
      result.current.openDrawer("agentList", { onSelect: onSave2 });
    });

    // onSave should no longer be in complexProps
    expect(getComplexProps()).not.toHaveProperty("onSave");
    expect(getComplexProps().onSelect).toBe(onSave2);
  });
});
