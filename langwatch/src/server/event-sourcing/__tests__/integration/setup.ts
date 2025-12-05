import { beforeAll, afterAll } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
  cleanupTestData,
} from "./testContainers";

/**
 * Global setup for integration tests.
 * Starts testcontainers before all tests and ensures clean state.
 */
export async function setup(): Promise<void> {
  await startTestContainers();
  // Clean up any leftover data from previous test runs
  await cleanupTestData();
}

/**
 * Global teardown for integration tests.
 * Stops testcontainers after all tests.
 */
export async function teardown(): Promise<void> {
  await cleanupTestData();
  await stopTestContainers();
}

// Register global setup/teardown hooks
beforeAll(setup, 60000); // 60 second timeout for container startup
afterAll(teardown, 30000); // 30 second timeout for cleanup
