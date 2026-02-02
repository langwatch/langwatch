import "@testing-library/jest-dom/vitest";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

// Mock ResizeObserver for tests using floating-ui/popper (Chakra menus, tooltips, etc.)
globalThis.ResizeObserver = class ResizeObserver {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  observe() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  unobserve() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  disconnect() {}
};
