import "@testing-library/jest-dom/vitest";
import dotenv from "dotenv";
import { vi } from "vitest";
import { TEST_PUBLIC_KEY } from "./ee/licensing/__tests__/fixtures/testKeys";

dotenv.config({ path: ".env" });

// Set TEST_PUBLIC_KEY for license verification in integration tests.
// This allows test licenses (signed with TEST_PRIVATE_KEY) to validate correctly.
process.env.LANGWATCH_LICENSE_PUBLIC_KEY = TEST_PUBLIC_KEY;

// Mock ResizeObserver for tests using floating-ui/popper (Chakra menus, tooltips, etc.)
globalThis.ResizeObserver = class ResizeObserver {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  observe() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  unobserve() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  disconnect() {}
};
