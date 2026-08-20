/**
 * The full resolution table for the navigation mode, away from React:
 * which of the three modes a device paints for every combination of a
 * stored pick, the last flag answer this device saw, and the current
 * flag answer.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { describe, expect, it } from "vitest";
import {
  isLegacyNavigationDevice,
  resolveNavigationMode,
} from "../resolveNavigationMode";

const pending = { status: "pending" } as const;
const on = { status: "answered", isEnabled: true } as const;
const off = { status: "answered", isEnabled: false } as const;

describe("resolveNavigationMode", () => {
  describe("given the reader picked the old navigation", () => {
    describe("when the flag has not answered", () => {
      it("resolves to legacy without waiting", () => {
        expect(
          resolveNavigationMode({
            storedMode: "legacy",
            isLastKnownFlagEnabled: true,
            flag: pending,
          }),
        ).toEqual({ status: "ready", mode: "legacy" });
      });
    });

    describe("when the flag is on", () => {
      it("keeps legacy, since the pick is an opt-out", () => {
        expect(
          resolveNavigationMode({
            storedMode: "legacy",
            isLastKnownFlagEnabled: true,
            flag: on,
          }),
        ).toEqual({ status: "ready", mode: "legacy" });
      });
    });
  });

  describe("given the reader picked a new mode", () => {
    describe("when the flag has not answered", () => {
      it("waits rather than flashing the old chrome", () => {
        expect(
          resolveNavigationMode({
            storedMode: "icon-rail",
            isLastKnownFlagEnabled: true,
            flag: pending,
          }),
        ).toEqual({ status: "loading" });
      });
    });

    describe("when the flag is on", () => {
      it("resolves to the picked mode", () => {
        expect(
          resolveNavigationMode({
            storedMode: "icon-rail",
            isLastKnownFlagEnabled: null,
            flag: on,
          }),
        ).toEqual({ status: "ready", mode: "icon-rail" });
      });
    });

    describe("when the flag is off", () => {
      it("resolves to legacy", () => {
        expect(
          resolveNavigationMode({
            storedMode: "icon-rail",
            isLastKnownFlagEnabled: true,
            flag: off,
          }),
        ).toEqual({ status: "ready", mode: "legacy" });
      });
    });
  });

  describe("given the reader picked nothing", () => {
    describe("when the flag is on", () => {
      it("resolves to the default mode", () => {
        expect(
          resolveNavigationMode({
            storedMode: null,
            isLastKnownFlagEnabled: null,
            flag: on,
          }),
        ).toEqual({ status: "ready", mode: "product-switcher" });
      });
    });

    describe("when the flag is off", () => {
      it("resolves to legacy", () => {
        expect(
          resolveNavigationMode({
            storedMode: null,
            isLastKnownFlagEnabled: true,
            flag: off,
          }),
        ).toEqual({ status: "ready", mode: "legacy" });
      });
    });

    describe("when the flag has not answered and never answered before", () => {
      it("resolves to legacy without waiting", () => {
        expect(
          resolveNavigationMode({
            storedMode: null,
            isLastKnownFlagEnabled: null,
            flag: pending,
          }),
        ).toEqual({ status: "ready", mode: "legacy" });
      });
    });

    describe("when the flag has not answered but was on last time", () => {
      it("resolves to the default mode without waiting", () => {
        expect(
          resolveNavigationMode({
            storedMode: null,
            isLastKnownFlagEnabled: true,
            flag: pending,
          }),
        ).toEqual({ status: "ready", mode: "product-switcher" });
      });
    });
  });
});

describe("isLegacyNavigationDevice", () => {
  describe("when the reader picked nothing and the flag never answered on", () => {
    it("counts the device as legacy", () => {
      expect(
        isLegacyNavigationDevice({
          storedMode: null,
          isLastKnownFlagEnabled: null,
        }),
      ).toBe(true);
      expect(
        isLegacyNavigationDevice({
          storedMode: null,
          isLastKnownFlagEnabled: false,
        }),
      ).toBe(true);
    });
  });

  describe("when the device runs a new mode", () => {
    it("does not count the device as legacy", () => {
      expect(
        isLegacyNavigationDevice({
          storedMode: null,
          isLastKnownFlagEnabled: true,
        }),
      ).toBe(false);
      expect(
        isLegacyNavigationDevice({
          storedMode: "product-switcher",
          isLastKnownFlagEnabled: null,
        }),
      ).toBe(false);
    });
  });
});
