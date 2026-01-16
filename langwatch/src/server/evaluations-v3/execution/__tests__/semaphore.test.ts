import { describe, it, expect } from "vitest";
import { createSemaphore } from "../semaphore";

describe("semaphore", () => {
  it("allows immediate acquisition when slots available", async () => {
    const semaphore = createSemaphore(2);

    expect(semaphore.available()).toBe(2);

    await semaphore.acquire();
    expect(semaphore.available()).toBe(1);

    await semaphore.acquire();
    expect(semaphore.available()).toBe(0);
  });

  it("releases slots correctly", async () => {
    const semaphore = createSemaphore(1);

    await semaphore.acquire();
    expect(semaphore.available()).toBe(0);

    semaphore.release();
    expect(semaphore.available()).toBe(1);
  });

  it("queues acquisitions when no slots available", async () => {
    const semaphore = createSemaphore(1);
    const order: number[] = [];

    // First acquisition succeeds immediately
    await semaphore.acquire();
    order.push(1);

    // Second acquisition will wait
    const secondAcquire = semaphore.acquire().then(() => {
      order.push(2);
    });

    // Third acquisition will also wait
    const thirdAcquire = semaphore.acquire().then(() => {
      order.push(3);
    });

    // Release to allow second to proceed
    semaphore.release();
    await secondAcquire;

    // Release to allow third to proceed
    semaphore.release();
    await thirdAcquire;

    expect(order).toEqual([1, 2, 3]);
  });

  it("handles concurrent acquisitions correctly", async () => {
    const semaphore = createSemaphore(3);
    const active: number[] = [];
    let maxActive = 0;

    const tasks = Array.from({ length: 10 }, (_, i) =>
      (async () => {
        await semaphore.acquire();
        active.push(i);
        maxActive = Math.max(maxActive, active.length);

        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 10));

        const idx = active.indexOf(i);
        if (idx !== -1) active.splice(idx, 1);
        semaphore.release();
      })()
    );

    await Promise.all(tasks);

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(active).toHaveLength(0);
    expect(semaphore.available()).toBe(3);
  });

  it("works with single concurrency", async () => {
    const semaphore = createSemaphore(1);
    const results: number[] = [];

    const tasks = [1, 2, 3].map(async (n) => {
      await semaphore.acquire();
      results.push(n);
      await new Promise((resolve) => setTimeout(resolve, 5));
      semaphore.release();
    });

    await Promise.all(tasks);

    // All tasks should complete
    expect(results).toHaveLength(3);
    expect(semaphore.available()).toBe(1);
  });
});
