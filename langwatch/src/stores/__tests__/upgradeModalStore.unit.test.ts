import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpgradeModalStore } from "../upgradeModalStore";

describe("upgradeModalStore", () => {
  beforeEach(() => {
    useUpgradeModalStore.getState().close();
  });

  describe("open()", () => {
    describe("when called with limitType, current, and max", () => {
      it("sets isOpen to true", () => {
        useUpgradeModalStore.getState().open("members", 3, 5);

        expect(useUpgradeModalStore.getState().isOpen).toBe(true);
      });

      it("sets variant to limit mode", () => {
        useUpgradeModalStore.getState().open("members", 3, 5);

        expect(useUpgradeModalStore.getState().variant).toEqual({
          mode: "limit",
          limitType: "members",
          current: 3,
          max: 5,
        });
      });

      it("populates legacy limitType field for backward compatibility", () => {
        useUpgradeModalStore.getState().open("members", 3, 5);

        const state = useUpgradeModalStore.getState();
        expect(state.limitType).toBe("members");
        expect(state.current).toBe(3);
        expect(state.max).toBe(5);
      });
    });
  });

  describe("openSeats()", () => {
    describe("when called with seat update parameters", () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);

      it("sets isOpen to true", () => {
        useUpgradeModalStore.getState().openSeats({
          organizationId: "org-123",
          currentSeats: 5,
          newSeats: 7,
          onConfirm,
        });

        expect(useUpgradeModalStore.getState().isOpen).toBe(true);
      });

      it("sets variant to seats mode", () => {
        useUpgradeModalStore.getState().openSeats({
          organizationId: "org-123",
          currentSeats: 5,
          newSeats: 7,
          onConfirm,
        });

        expect(useUpgradeModalStore.getState().variant).toEqual({
          mode: "seats",
          organizationId: "org-123",
          currentSeats: 5,
          newSeats: 7,
          onConfirm,
        });
      });
    });
  });

  describe("close()", () => {
    describe("when the store has an open modal", () => {
      beforeEach(() => {
        useUpgradeModalStore.getState().open("members", 3, 5);
      });

      it("sets isOpen to false", () => {
        useUpgradeModalStore.getState().close();

        expect(useUpgradeModalStore.getState().isOpen).toBe(false);
      });

      it("resets variant to null", () => {
        useUpgradeModalStore.getState().close();

        expect(useUpgradeModalStore.getState().variant).toBeNull();
      });

      it("resets legacy fields to null", () => {
        useUpgradeModalStore.getState().close();

        const state = useUpgradeModalStore.getState();
        expect(state.limitType).toBeNull();
        expect(state.current).toBeNull();
        expect(state.max).toBeNull();
      });
    });

    describe("when the store has an open seats modal", () => {
      beforeEach(() => {
        useUpgradeModalStore.getState().openSeats({
          organizationId: "org-123",
          currentSeats: 5,
          newSeats: 7,
          onConfirm: vi.fn().mockResolvedValue(undefined),
        });
      });

      it("sets isOpen to false", () => {
        useUpgradeModalStore.getState().close();

        expect(useUpgradeModalStore.getState().isOpen).toBe(false);
      });

      it("resets variant to null", () => {
        useUpgradeModalStore.getState().close();

        expect(useUpgradeModalStore.getState().variant).toBeNull();
      });
    });
  });
});
