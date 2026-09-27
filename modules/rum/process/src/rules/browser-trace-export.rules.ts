/**
 * An OTLP/JSON trace export from a public browser, read only as far as the
 * door needs to bound its cost and fix its identity (ADR-058). Everything the
 * door does not touch passes through to the collector untouched.
 */
import { RUM_SERVICE_NAME } from "@langwatch/react-rum/constants";
import { z } from "zod";

const walkableObject = z.record(z.string(), z.unknown());

const resourceSpansSchema = z.looseObject({
  resource: z.looseObject({ attributes: z.array(walkableObject).optional() }).optional(),
  scopeSpans: z.array(z.looseObject({ spans: z.array(z.unknown()).optional() })).optional(),
});

const traceExportSchema = z.looseObject({
  resourceSpans: z.array(resourceSpansSchema).min(1),
});

export type OtlpResourceSpans = z.infer<typeof resourceSpansSchema>;
export type BrowserTraceExport = z.infer<typeof traceExportSchema>;

export type ParsedTraceExport =
  | Readonly<{ walkable: true; traceExport: BrowserTraceExport }>
  | Readonly<{ walkable: false }>;

/** Every field the door walks has the shape it walks, or the body is refused as malformed. */
export function parseTraceExport(body: string): ParsedTraceExport {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { walkable: false };
  }
  const parsed = traceExportSchema.safeParse(json);
  return parsed.success ? { walkable: true, traceExport: parsed.data } : { walkable: false };
}

/** Total spans across every resource and scope in the export. */
export function countSpans(resourceSpans: readonly OtlpResourceSpans[]): number {
  let count = 0;
  for (const resourceSpan of resourceSpans) {
    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      count += scopeSpan.spans?.length ?? 0;
    }
  }
  return count;
}

const OWNED_ATTRIBUTES: ReadonlySet<string> = new Set(["service.name", "langwatch.origin"]);

/** Identity is overwritten, not validated: a repeated `service.name` beats a first-match check. */
export function withPlatformIdentity(traceExport: BrowserTraceExport): BrowserTraceExport {
  return {
    ...traceExport,
    resourceSpans: traceExport.resourceSpans.map((resourceSpan) => {
      const resource = resourceSpan.resource ?? {};
      return {
        ...resourceSpan,
        resource: {
          ...resource,
          attributes: [
            ...(resource.attributes ?? []).filter(
              (attribute) =>
                typeof attribute.key !== "string" || !OWNED_ATTRIBUTES.has(attribute.key),
            ),
            { key: "service.name", value: { stringValue: RUM_SERVICE_NAME } },
            { key: "langwatch.origin", value: { stringValue: "platform_internal" } },
          ],
        },
      };
    }),
  };
}
