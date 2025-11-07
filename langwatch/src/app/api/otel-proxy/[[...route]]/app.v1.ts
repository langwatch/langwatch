import { Hono } from "hono";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";

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

// OTLP Traces proxy (with optional AWS SigV4 signing)
app.post("/v1/traces", async (c) => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return c.body(null, 204);
  }

  const target = new URL(endpoint);
  const body = await c.req.raw.arrayBuffer();

  try {
    const defaultHeaders: Record<string, string> = {
      "content-type": "application/json",
    };

    let response: Response;

    if (target.hostname.endsWith(".amazonaws.com")) {
      const signer = new SignatureV4({
        service: "xray",
        region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
        // Credentials are resolved by the AWS SDK provider chain in runtime environments
        // @ts-ignore
        credentials: undefined,
        sha256: Sha256,
      });

      const signed = await signer.sign({
        method: "POST",
        protocol: target.protocol.replace(":", ""),
        hostname: target.hostname,
        path: target.pathname || "/v1/traces",
        headers: defaultHeaders,
        body,
      });

      response = await fetch(endpoint, {
        method: "POST",
        headers: signed.headers as Record<string, string>,
        body,
      });
    } else {
      response = await fetch(`${endpoint}/v1/traces`, {
        method: "POST",
        headers: defaultHeaders,
        body,
      });
    }

    const buf = await response.arrayBuffer();
    return new Response(buf, { status: response.status });
  } catch {
    return c.body(null, 500);
  }
});


