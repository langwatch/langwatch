import { createLogger, validationMeta } from "@langwatch/observability";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { resolver } from "hono-openapi";
import type { AccessPolicy } from "../access-policy.ts";
import { bodyLimit } from "./body-limit.ts";
import type { RestApiVersionedFamily } from "./security/rest-api-service.ts";
import type { VersionLabel } from "./types.ts";

const logger = createLogger("langwatch:api:json-protocol");

type ProtocolOptions<
  App,
  Input extends z.ZodType,
  Output extends z.ZodType<object>,
  Facts extends z.ZodObject,
> = {
  family: RestApiVersionedFamily;
  app: () => App;
  method: "get" | "post";
  path: string;
  version: VersionLabel;
  operation: string;
  description: string;
  tags?: readonly string[];
  responses?: Readonly<Record<number, { description: string }>>;
  access: AccessPolicy;
  input: Input;
  output: Output;
  facts: Facts;
  headers: { [Key in keyof z.input<Facts>]: string };
  maxPayloadBytes?: number;
  payloadError?: () => Error;
  inputError: () => Error;
  error: (error: unknown) => z.output<Output>;
  status: (response: z.output<Output>) => ContentfulStatusCode;
  handle: (
    args: { app: App; input: z.output<Input>; signal: AbortSignal },
    facts: z.output<Facts>,
  ) => Promise<z.output<Output>>;
};

/** JSON session protocols own their frame/status grammar and receive only declared header facts. */
export function registerJsonProtocol<
  App,
  Input extends z.ZodType,
  Output extends z.ZodType<object>,
  Facts extends z.ZodObject,
>(options: ProtocolOptions<App, Input, Output, Facts>): void {
  options.family.service.registerTransportRoute(
    options.method,
    options.path,
    options.version,
    async (context, body) => {
      const facts = options.facts.parse(
        Object.fromEntries(
          Object.entries(options.headers).map(([key, name]) => [
            key,
            context.req.header(String(name)),
          ]),
        ),
      );

      let response: z.output<Output>;

      try {
        const raw = options.method === "get" ? context.req.query() : jsonBody(body);
        const input = options.input.safeParse(raw);
        if (!input.success) throw options.inputError();

        response = await options.handle(
          { app: options.app(), input: input.data, signal: context.req.raw.signal },
          facts,
        );
      } catch (error) {
        response = options.error(error);
      }

      const output = options.output.safeParse(response);

      if (!output.success) {
        logger.error(
          {
            endpoint: options.operation,
            method: options.method,
            validation: validationMeta(output.error, { privacy: "schema-only" }),
          },
          "Protocol response did not match its declared output schema",
        );
      }

      return context.json(response, options.status(response));
    },
    (endpoint) => {
      let route = options.family
        .policy(options.access)(endpoint)
        .withRawResponse(
          "The session protocol declares its own JSON frame and HTTP status grammar.",
          { contentType: "application/json" },
        )
        .withDocs({
          operationId: options.operation,
          description: options.description,
          tags: options.tags ? [...options.tags] : void 0,
          responses: {
            ...options.responses,
            200: {
              description: options.responses?.[200]?.description ?? "Protocol response",
              content: { "application/json": { schema: resolver(options.output) } },
            },
          },
        });

      if (options.method === "post")
        route = route.withRawBody("text", { contentType: "application/json" });

      if (options.maxPayloadBytes !== void 0) {
        route = route.withMiddleware(
          bodyLimit({
            maxSize: options.maxPayloadBytes,
            onError: () => {
              throw options.payloadError?.() ?? new Error("Protocol payload is too large.");
            },
          }),
        );
      }

      return route;
    },
  );
}

function jsonBody(input: unknown): unknown {
  const body = z.object({ body: z.string() }).parse(input).body;

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
