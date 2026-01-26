import "@testing-library/jest-dom/vitest";
import dotenv from "dotenv";
import { initializeEventSourcingForTesting } from "~/server/event-sourcing";

dotenv.config({ path: ".env" });

// Initialize event sourcing with in-memory stores for tests
initializeEventSourcingForTesting();

// Mock ResizeObserver for tests using floating-ui/popper (Chakra menus, tooltips, etc.)
globalThis.ResizeObserver = class ResizeObserver {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  observe() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  unobserve() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  disconnect() {}
};
