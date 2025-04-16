import { handle } from "hono/vercel";
import { app } from "./app";

// Export handlers for all HTTP methods
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
