/**
 * Semaphore - Simple concurrency limiter for parallel execution.
 */

export type Semaphore = {
  acquire: () => Promise<void>;
  release: () => void;
  available: () => number;
};

/**
 * Creates a semaphore with a given concurrency limit.
 */
export const createSemaphore = (concurrency: number): Semaphore => {
  let available = concurrency;
  const queue: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    return new Promise((resolve) => {
      if (available > 0) {
        available--;
        resolve();
      } else {
        queue.push(resolve);
      }
    });
  };

  const release = (): void => {
    const next = queue.shift();
    if (next) {
      next();
    } else {
      available++;
    }
  };

  return {
    acquire,
    release,
    available: () => available,
  };
};
