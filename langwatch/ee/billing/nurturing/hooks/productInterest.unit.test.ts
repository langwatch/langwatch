import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireIntegrationMethodNurturing,
  mapProductSelectionToIntegrationMethod,
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

describe("mapProductSelectionToIntegrationMethod()", () => {
  describe("when given a valid product selection", () => {
    it("maps 'via-claude-code' to 'coding_agent'", () => {
      expect(mapProductSelectionToIntegrationMethod("via-claude-code")).toBe("coding_agent");
    });

    it("maps 'via-platform' to 'platform'", () => {
      expect(mapProductSelectionToIntegrationMethod("via-platform")).toBe("platform");
    });

    it("maps 'via-claude-desktop' to 'mcp'", () => {
      expect(mapProductSelectionToIntegrationMethod("via-claude-desktop")).toBe("mcp");
    });

    it("maps 'manually' to 'manual_sdk'", () => {
      expect(mapProductSelectionToIntegrationMethod("manually")).toBe("manual_sdk");
    });
  });

  describe("when given an unknown selection", () => {
    it("throws an error", () => {
      expect(() => mapProductSelectionToIntegrationMethod("unknown")).toThrow(
        "Unknown product selection: unknown"
      );
    });
  });
});

describe("fireIntegrationMethodNurturing()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentNurturing = mockNurturing;
  });

  describe("when the user selects an integration method", () => {
    it("sends only integration_method trait via identifyUser", () => {
      fireIntegrationMethodNurturing({
        userId: "user-123",
        integrationMethod: "coding_agent",
      });

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-123",
        traits: { integration_method: "coding_agent" },
      });
    });

    it("does not re-send other signup traits", () => {
      fireIntegrationMethodNurturing({
        userId: "user-123",
        integrationMethod: "platform",
      });

      const call = mockNurturing.identifyUser.mock.calls[0]![0];
      expect(Object.keys(call.traits)).toEqual(["integration_method"]);
    });

    it("does not call trackEvent or groupUser", () => {
      fireIntegrationMethodNurturing({
        userId: "user-123",
        integrationMethod: "mcp",
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
        fireIntegrationMethodNurturing({
          userId: "user-123",
          integrationMethod: "coding_agent",
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

      fireIntegrationMethodNurturing({
        userId: "user-123",
        integrationMethod: "manual_sdk",
      });

      expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
    });
  });
});
