import { describe, expect, it, vi } from "vitest";

import {
  runDeliveryMarkingProgress,
  runOutsideDelivery,
  trackDeliveryProgress,
} from "../deliveryProgress.ts";

class Rows {
  readonly #rows: string[] = [];

  async insert(row: string): Promise<number> {
    this.#rows.push(row);
    return this.#rows.length;
  }

  fail(): Promise<never> {
    return Promise.reject(new Error("refused"));
  }
}

describe("trackDeliveryProgress", () => {
  describe("when one delivery calls a repository two deliveries share", () => {
    /** @scenario "Only calls made inside a delivery mark its progress" */
    it("marks the calling delivery when the call starts and settles, and no other", async () => {
      const repository = trackDeliveryProgress({ rows: new Rows() });
      const caller = vi.fn();
      const bystander = vi.fn();
      let release: () => void = () => undefined;
      const idle = runDeliveryMarkingProgress({
        markProgress: bystander,
        run: () => new Promise<void>((resolve) => (release = resolve)),
      });

      const count = await runDeliveryMarkingProgress({
        markProgress: caller,
        run: () => repository.rows.insert("first"),
      });
      release();
      await idle;

      expect(count).toBe(1);
      expect(caller).toHaveBeenCalledTimes(2);
      expect(bystander).not.toHaveBeenCalled();
    });

    /** @scenario "Only calls made inside a delivery mark its progress" */
    it("marks it when a call's promise rejects, and the caller still sees the rejection", async () => {
      const repository = trackDeliveryProgress(new Rows());
      const markProgress = vi.fn();

      const failed = runDeliveryMarkingProgress({ markProgress, run: () => repository.fail() });

      await expect(failed).rejects.toThrow("refused");
      expect(markProgress).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a call is made outside any delivery", () => {
    /** @scenario "Only calls made inside a delivery mark its progress" */
    it("passes straight through and marks nothing", async () => {
      const markProgress = vi.fn();
      const repository = trackDeliveryProgress(new Rows());
      await runDeliveryMarkingProgress({ markProgress, run: () => Promise.resolve() });

      await expect(repository.insert("outside")).resolves.toBe(1);
      expect(markProgress).not.toHaveBeenCalled();
    });
  });

  describe("when a delivery arms work outside itself", () => {
    /** @scenario "Only calls made inside a delivery mark its progress" */
    it("marks nothing for the calls that work makes", async () => {
      const repository = trackDeliveryProgress(new Rows());
      const markProgress = vi.fn();

      await runDeliveryMarkingProgress({
        markProgress,
        run: () => runOutsideDelivery(() => repository.insert("renewal")),
      });

      expect(markProgress).not.toHaveBeenCalled();
    });
  });

  describe("when a client hands back something other than a native promise", () => {
    /** @scenario "Only calls made inside a delivery mark its progress" */
    it("marks the start only and leaves the result untouched, so a lazy query never runs early", () => {
      const query = { sql: "select 1" };
      const client = trackDeliveryProgress({ project: { findMany: () => query } });
      const markProgress = vi.fn();

      const result = runDeliveryMarkingProgress({
        markProgress,
        run: () => client.project.findMany(),
      });

      expect(result).toBe(query);
      expect(markProgress).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a dependency carries a frozen property", () => {
    /** @scenario "Only calls made inside a delivery mark its progress" */
    it("hands that property back as itself", () => {
      const settings = { region: "eu" };
      const dependency = trackDeliveryProgress(Object.freeze({ settings }));

      expect(dependency.settings).toBe(settings);
    });
  });
});
