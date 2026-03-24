import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireProductInterestNurturing,
  mapProductSelectionToTrait,
} from "./productInterest";

vi.mock("../../../../src/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

const mockNurturing = {
  identifyUser: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  groupUser: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn().mockResolvedValue(undefined),
};

let currentNurturing: typeof mockNurturing | undefined = mockNurturing;

vi.mock("../../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    get nurturing() {
      return currentNurturing;
    },
  }),
}));

describe("mapProductSelectionToTrait()", () => {
  describe("when given a valid product selection", () => {
    it("maps 'via-claude-code' to 'coding_agent'", () => {
      expect(mapProductSelectionToTrait("via-claude-code")).toBe("coding_agent");
    });

    it("maps 'via-platform' to 'platform'", () => {
      expect(mapProductSelectionToTrait("via-platform")).toBe("platform");
    });

    it("maps 'via-claude-desktop' to 'mcp'", () => {
      expect(mapProductSelectionToTrait("via-claude-desktop")).toBe("mcp");
    });

    it("maps 'manually' to 'manual_sdk'", () => {
      expect(mapProductSelectionToTrait("manually")).toBe("manual_sdk");
    });
  });

  describe("when given an unknown selection", () => {
    it("throws an error", () => {
      expect(() => mapProductSelectionToTrait("unknown")).toThrow(
        "Unknown product selection: unknown"
      );
    });
  });
});

describe("fireProductInterestNurturing()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentNurturing = mockNurturing;
  });

  describe("when the user selects a product interest", () => {
    it("sends only product_interest trait via identifyUser", () => {
      fireProductInterestNurturing({
        userId: "user-123",
        productInterest: "coding_agent",
      });

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-123",
        traits: { product_interest: "coding_agent" },
      });
    });

    it("does not re-send other signup traits", () => {
      fireProductInterestNurturing({
        userId: "user-123",
        productInterest: "platform",
      });

      const call = mockNurturing.identifyUser.mock.calls[0]![0];
      expect(Object.keys(call.traits)).toEqual(["product_interest"]);
    });

    it("does not call trackEvent or groupUser", () => {
      fireProductInterestNurturing({
        userId: "user-123",
        productInterest: "mcp",
      });

      expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
      expect(mockNurturing.groupUser).not.toHaveBeenCalled();
    });
  });

  describe("when Customer.io API is unavailable", () => {
    it("does not throw (fire-and-forget)", async () => {
      const { captureException } = await import(
        "../../../../src/utils/posthogErrorCapture"
      );
      mockNurturing.identifyUser.mockRejectedValueOnce(
        new Error("CIO unavailable")
      );

      expect(() =>
        fireProductInterestNurturing({
          userId: "user-123",
          productInterest: "coding_agent",
        })
      ).not.toThrow();

      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalled();
      });
    });
  });

  describe("when nurturing is undefined (no Customer.io key)", () => {
    it("silently skips without calling any nurturing methods", () => {
      currentNurturing = undefined;

      fireProductInterestNurturing({
        userId: "user-123",
        productInterest: "manual_sdk",
      });

      expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
    });
  });
});
