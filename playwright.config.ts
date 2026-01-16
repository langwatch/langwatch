/**
 * Root Playwright Config
 *
 * This config exists for the Playwright MCP tools to find.
 * It re-exports the config from agentic-e2e-tests/.
 *
 * For running tests directly, use:
 *   cd agentic-e2e-tests && pnpm test
 */

export { default } from "./agentic-e2e-tests/playwright.config";
