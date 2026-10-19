// @vitest-environment jsdom
/**
 * The global UI store: a module writes only its own slice and reads any.
 * Spec: specs/ui/browser-global-store.feature.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { defineSlice, readSlice } from "../global-store.ts";
import { clearReaderUiStorage, setUiStorageReader } from "../storage.ts";

type Counter = { count: number; label: string; bump: () => void };

const counterSlice = (name: string, persist = false) => {
  const slice = defineSlice<Counter>({
    name,
    create: (set) => ({
      count: 0,
      label: "initial",
      bump: () => set((state) => ({ count: state.count + 1 })),
    }),
    persist: persist ? { partialize: ({ count }) => ({ count }) } : void 0,
  });
  return slice;
};

describe("given two modules that each declared a slice", () => {
  beforeEach(() => window.localStorage.clear());

  describe("when one writes its own slice", () => {
    /** @scenario "A module writes only its own slice and reads any slice" */
    it("leaves the other slice alone and lets the other module read the write", () => {
      const langy = counterSlice("langy:store");
      const trace = counterSlice("trace:explorer");

      langy.getState().bump();
      langy.setState({ label: "changed" });

      expect(trace.getState()).toMatchObject({ count: 0, label: "initial" });
      const reader = readSlice<Counter>({ name: "langy:store" });
      expect(reader.getState()).toMatchObject({ count: 1, label: "changed" });
      expect("setState" in reader).toBe(false);
    });

    /** @scenario "A module writes only its own slice and reads any slice" */
    it("tells a subscriber only about its own slice", () => {
      const langy = counterSlice("langy:store");
      const trace = counterSlice("trace:explorer");
      const heard: number[] = [];
      readSlice<Counter>({ name: "langy:store" }).subscribe((state) => heard.push(state.count));

      trace.getState().bump();
      langy.getState().bump();

      expect(heard).toEqual([1]);
    });

    /** @scenario "A module writes only its own slice and reads any slice" */
    it("refuses a slice name that is not <module>:<key>", () => {
      expect(() => counterSlice("langy")).toThrow('must be "<module>:<key>"');
    });
  });
});

describe("given a persisted slice", () => {
  beforeEach(() => {
    clearReaderUiStorage();
    window.localStorage.clear();
    setUiStorageReader("user-a");
  });

  describe("when the module is declared again after a write", () => {
    /** @scenario "A persisted slice survives a reload and keeps only the keys it chose" */
    it("restores the kept keys and starts the rest from initial", () => {
      const first = counterSlice("trace:explorer", true);
      first.getState().bump();
      first.setState({ label: "session only" });

      const reloaded = counterSlice("trace:explorer", true);

      expect(reloaded.getState()).toMatchObject({ count: 1, label: "initial" });
      expect(
        JSON.parse(window.localStorage.getItem("langwatch:user:user-a:trace:explorer") ?? "{}"),
      ).toEqual({ state: { count: 1 }, version: 0 });
    });
  });

  describe("when a different reader signs in on the same device", () => {
    /** @scenario "A persisted preference belongs to the reader who chose it" */
    it("starts them from initial and gives the first reader theirs back", () => {
      const slice = counterSlice("trace:explorer", true);
      slice.getState().bump();

      setUiStorageReader("user-b");
      expect(slice.getState().count).toBe(0);
      expect(counterSlice("trace:explorer", true).getState().count).toBe(0);

      setUiStorageReader("user-a");
      expect(slice.getState().count).toBe(1);
    });
  });

  describe("when nobody is signed in", () => {
    /** @scenario "A persisted preference belongs to the reader who chose it" */
    it("remembers nothing", () => {
      setUiStorageReader(void 0);
      counterSlice("trace:explorer", true).getState().bump();

      expect(window.localStorage.length).toBe(0);
    });
  });

  describe("when the reader signs out", () => {
    /** @scenario "Sign-out forgets every persisted preference on the device" */
    it("removes every reader's persisted keys and leaves other keys alone", () => {
      window.localStorage.setItem("unrelated", "kept");
      const slice = counterSlice("trace:explorer", true);
      slice.getState().bump();
      setUiStorageReader("user-b");
      slice.getState().bump();

      clearReaderUiStorage();

      const left = Array.from({ length: window.localStorage.length }, (_, index) =>
        window.localStorage.key(index),
      );
      expect(left).toEqual(["unrelated"]);
      expect(slice.getState().count).toBe(0);
      setUiStorageReader("user-a");
      expect(slice.getState().count).toBe(0);
    });
  });
});

describe("given a slice nobody declared", () => {
  describe("when a reader named what it sees without the owner", () => {
    /** @scenario "Reading a slice nobody declared is refused by name" */
    it("answers that instead of refusing", () => {
      const absent = { count: -1, label: "absent", bump: () => {} };
      expect(readSlice<Counter>({ name: "nobody:here", absent }).getState()).toBe(absent);
    });
  });

  describe("when a module reads it", () => {
    /** @scenario "Reading a slice nobody declared is refused by name" */
    it("fails naming the slice", () => {
      expect(() => readSlice<Counter>({ name: "nobody:here" }).getState()).toThrow('"nobody:here"');
    });
  });
});
