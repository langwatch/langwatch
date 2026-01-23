import { afterAll, beforeAll } from "vitest";
import {
  cleanupTestData,
  loadGlobalSetupContainerInfo,
  startTestContainers,
  stopTestContainers,
} from "./testContainers";

/**
 * Global setup for integration tests.
 * Loads container info from globalSetup (if available) and connects.
 */
export async function setup(): Promise<void> {
  // First, try to load container info from globalSetup's temp file
  // This sets env vars that startTestContainers() will use
  loadGlobalSetupContainerInfo();

  try {
    await startTestContainers();
  } catch (error) {
    throw error;
  }
  // Don't clean up all data here - each test uses unique tenant IDs
  // and cleans up its own data in afterEach
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
