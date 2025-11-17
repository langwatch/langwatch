import { Hono } from "hono";

export const app = new Hono().basePath("/");

// OTLP Metrics proxy
app.post("/v1/metrics", async (c) => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return c.body(null, 204);
  }

  const body = await c.req.raw.arrayBuffer();

  try {
    const res = await fetch(`${endpoint}/v1/metrics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const buf = await res.arrayBuffer();
    return new Response(buf, { status: res.status });
  } catch {
    return c.body(null, 500);
  }
});

// OTLP Traces proxy
app.post("/v1/traces", async (c) => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return c.body(null, 204);
  }

  const body = await c.req.raw.arrayBuffer();

  try {
    const defaultHeaders: Record<string, string> = {
      "content-type": "application/json",
    };


    const response = await fetch(`${endpoint}/v1/traces`, {
      method: "POST",
      headers: defaultHeaders,
      body,
    });

    const buf = await response.arrayBuffer();
    return new Response(buf, { status: response.status });
  } catch {
    return c.body(null, 500);
  }
});


