/**
 * The API process's root tRPC router type, `import type`-only.
 */
import type { ApiApplication } from "../api.application.ts";

export type AppRouter = ApiApplication["trpc"];
