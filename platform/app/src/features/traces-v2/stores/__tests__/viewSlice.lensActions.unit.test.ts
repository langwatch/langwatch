// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExplorerStore } from "../explorerStore";
import {
  type LensConfig,
  type LensSyncBridge,
  setLensSyncBridge,
} from "../viewSlice";

/**
 * Renaming, duplicating and deleting a lens edit the lens strip locally and
 * hand saved-lens writes to the sync bridge. Built-in lenses are never
 * written: renaming one does nothing, and deleting one only dismisses it in
 * this browser. When the bridged project refuses writes (an aggregate), no
 * saved-lens change happens at all.
 */

const builtIns = useExplorerStore
  .getState()
  .allLenses.filter((lens) => lens.isBuiltIn);

const MY_LENS: LensConfig = {
  id: "custom-my-lens",
  name: "My Lens",
  isBuiltIn: false,
  columns: ["time", "cost"],
  addons: [],
  grouping: "flat",
  sort: { columnId: "cost", direction: "asc" },
  filterText: "status:error",
};

function makeBridge({ acceptsWrites }: { acceptsWrites: boolean }) {
  return {
    acceptsWrites: () => acceptsWrites,
    create: vi.fn<LensSyncBridge["create"]>(),
    rename: vi.fn<LensSyncBridge["rename"]>(),
    delete: vi.fn<LensSyncBridge["delete"]>(),
  };
}

let bridge: ReturnType<typeof makeBridge>;

const store = () => useExplorerStore.getState();
const lensIds = () => store().allLenses.map((lens) => lens.id);
const lensById = (id: string) => store().allLenses.find((l) => l.id === id);

beforeEach(() => {
  localStorage.clear();
  bridge = makeBridge({ acceptsWrites: true });
  setLensSyncBridge(bridge);
  useExplorerStore.setState({
    allLenses: [...builtIns, MY_LENS],
    activeLensId: "all-traces",
    draftState: new Map(),
  });
});

afterEach(() => {
  setLensSyncBridge(null);
  localStorage.clear();
});

describe("viewStore lens actions", () => {
  describe("renameLens()", () => {
    describe("when renaming a saved lens", () => {
      it("renames it in the strip and sends the rename to the server", () => {
        store().renameLens(MY_LENS.id, "Renamed Lens");

        expect(lensById(MY_LENS.id)?.name).toBe("Renamed Lens");
        expect(bridge.rename).toHaveBeenCalledWith(MY_LENS.id, "Renamed Lens");
      });
    });

    describe("when renaming a built-in lens", () => {
      it("leaves its name alone and sends nothing", () => {
        store().renameLens("all-traces", "Everything");

        expect(lensById("all-traces")?.name).toBe("All");
        expect(bridge.rename).not.toHaveBeenCalled();
      });
    });

    describe("when the project refuses lens writes", () => {
      it("leaves the name alone and sends nothing", () => {
        bridge = makeBridge({ acceptsWrites: false });
        setLensSyncBridge(bridge);

        store().renameLens(MY_LENS.id, "Renamed Lens");

        expect(lensById(MY_LENS.id)?.name).toBe("My Lens");
        expect(bridge.rename).not.toHaveBeenCalled();
      });
    });
  });

  describe("duplicateLens()", () => {
    describe("when duplicating a saved lens", () => {
      it("appends a copy with the saved config and makes it active", () => {
        const copyId = store().duplicateLens(MY_LENS.id);

        expect(copyId).not.toBe(MY_LENS.id);
        expect(lensIds().at(-1)).toBe(copyId);
        expect(lensById(copyId)).toEqual({
          ...MY_LENS,
          id: copyId,
          name: "My Lens (copy)",
        });
        expect(store().activeLensId).toBe(copyId);
        expect(store().sort).toEqual(MY_LENS.sort);
        expect(store().columnOrder).toEqual(MY_LENS.columns);
      });

      it("sends the copy to the server with the lens to fall back to", () => {
        const copyId = store().duplicateLens(MY_LENS.id);

        expect(bridge.create).toHaveBeenCalledWith(
          expect.objectContaining({ id: copyId, name: "My Lens (copy)" }),
          { fallbackLensId: "all-traces" },
        );
      });
    });

    describe("when duplicating a built-in lens", () => {
      it("creates a saved lens, not another built-in", () => {
        const copyId = store().duplicateLens("all-traces");

        expect(lensById(copyId)).toMatchObject({
          name: "All (copy)",
          isBuiltIn: false,
        });
      });
    });

    describe("when the lens does not exist", () => {
      it("returns the id it was given and adds nothing", () => {
        const before = lensIds();

        expect(store().duplicateLens("missing")).toBe("missing");
        expect(lensIds()).toEqual(before);
        expect(bridge.create).not.toHaveBeenCalled();
      });
    });

    describe("when the project refuses lens writes", () => {
      it("adds no copy and stays on the current lens", () => {
        bridge = makeBridge({ acceptsWrites: false });
        setLensSyncBridge(bridge);
        const before = lensIds();

        expect(store().duplicateLens(MY_LENS.id)).toBe(MY_LENS.id);
        expect(lensIds()).toEqual(before);
        expect(store().activeLensId).toBe("all-traces");
      });
    });
  });

  describe("deleteLens()", () => {
    describe("when deleting a saved lens that is not active", () => {
      it("removes it, sends the delete and keeps the active lens", () => {
        store().deleteLens(MY_LENS.id);

        expect(lensById(MY_LENS.id)).toBeUndefined();
        expect(bridge.delete).toHaveBeenCalledWith(MY_LENS.id);
        expect(store().activeLensId).toBe("all-traces");
      });
    });

    describe("when deleting the active lens", () => {
      it("moves to the first remaining lens", () => {
        store().selectLens(MY_LENS.id);

        store().deleteLens(MY_LENS.id);

        const first = store().allLenses[0];
        expect(store().activeLensId).toBe(first?.id);
        expect(store().sort).toEqual(first?.sort);
        expect(store().columnOrder).toEqual(first?.columns);
      });

      it("drops the lens's unsaved changes", () => {
        store().selectLens(MY_LENS.id);
        store().setFilterDraft("status:ok");
        expect(store().draftState.has(MY_LENS.id)).toBe(true);

        store().deleteLens(MY_LENS.id);

        expect(store().draftState.has(MY_LENS.id)).toBe(false);
      });
    });

    describe("when deleting the All lens", () => {
      it("keeps it, since the strip must always offer a way back", () => {
        store().deleteLens("all-traces");

        expect(lensById("all-traces")).toBeDefined();
      });
    });

    describe("when only one lens remains", () => {
      it("keeps it", () => {
        useExplorerStore.setState({
          allLenses: [MY_LENS],
          activeLensId: MY_LENS.id,
        });

        store().deleteLens(MY_LENS.id);

        expect(lensIds()).toEqual([MY_LENS.id]);
        expect(bridge.delete).not.toHaveBeenCalled();
      });
    });

    describe("when the project refuses lens writes", () => {
      beforeEach(() => {
        bridge = makeBridge({ acceptsWrites: false });
        setLensSyncBridge(bridge);
      });

      it("keeps a saved lens", () => {
        store().deleteLens(MY_LENS.id);

        expect(lensById(MY_LENS.id)).toBeDefined();
        expect(bridge.delete).not.toHaveBeenCalled();
      });

      it("still dismisses a built-in lens, which is local only", () => {
        const builtIn = builtIns.find((lens) => lens.id !== "all-traces");
        if (!builtIn) throw new Error("expected a second built-in lens");

        store().deleteLens(builtIn.id);

        expect(lensById(builtIn.id)).toBeUndefined();
        expect(bridge.delete).not.toHaveBeenCalled();
      });
    });
  });
});
