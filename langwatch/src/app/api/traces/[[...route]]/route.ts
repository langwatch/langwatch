import { handle } from "hono/vercel";
import { app } from "./app";

export const GET = handle(app);
export const POST = handle(app);
