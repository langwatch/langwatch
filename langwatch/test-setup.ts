import "@testing-library/jest-dom/vitest";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

// Mock ResizeObserver for tests using floating-ui/popper (Chakra menus, tooltips, etc.)
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
