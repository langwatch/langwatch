import { Hono } from "hono";

import { app as appV1 } from "./app.v1";

// Define the Hono app
export const app = new Hono().basePath("/api/otel-proxy");

// Mount versioned routes
app.route("/", appV1);
