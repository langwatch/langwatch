import { env } from "../../../env.mjs";
import type { ElasticSearchSpan, Trace } from "../../../server/tracer/types";
import { getDebugger } from "../../../utils/logger";
import {
  ComprehendClient,
  DetectPiiEntitiesCommand,
} from "@aws-sdk/client-comprehend";

const debug = getDebugger("langwatch:trace_checks:piiCheck");

export const runPiiCheck = async (
  trace: Trace,
  spans: ElasticSearchSpan[],
  enforced = true
): Promise<{
  quotes: string[];
}> => {
  const accessKeyId = env.AWS_COMPREHEND_ACCESS_KEY_ID;
  const secretKey = env.AWS_COMPREHEND_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretKey) {
    if (enforced) {
      throw new Error(
        "AWS_COMPREHEND_ACCESS_KEY_ID and AWS_COMPREHEND_SECRET_ACCESS_KEY are not set, PII check cannot be performed"
      );
    }
    console.warn(
      "WARNING: AWS_COMPREHEND_ACCESS_KEY_ID and AWS_COMPREHEND_SECRET_ACCESS_KEY are not set, so PII check will not be performed, you are risking storing PII on the database, please set them if you wish to avoid that, this will fail in production by default"
    );
    return {
      quotes: [],
    };
  }

  debug("Checking PII for trace", trace.trace_id);

  const comprehend = new ComprehendClient({
    region: "eu-central-1",
    credentials: {
      accessKeyId,
      secretAccessKey: secretKey,
    },
  });

  const traceText = [
    trace.input.value,
    trace.output?.value ?? "",
    trace.error?.message ?? "",
    trace.error?.stacktrace ?? "",
  ].join("\n\n");
  const spansText = spans
    .flatMap((span) =>
      [span.input?.value ?? "", span.error?.message ?? ""]
        .concat(span.outputs.map((x) => x.value))
        .concat(
          (span.contexts ?? []).flatMap((x) => {
            if (Array.isArray(x)) {
              return x;
            }

            if (typeof x.content === "object") {
              return Object.entries(x.content);
            }

            return [x.content];
          })
        )
        .concat(span.error?.stacktrace ?? [])
    )
    .join("\n\n");

  const piiCheck = async (text: string) => {
    const result = await comprehend.send(
      new DetectPiiEntitiesCommand({
        Text: text,
        LanguageCode: "en",
      })
    );

    return result.Entities ?? [];
  };

  const traceOffsetFindings = (await piiCheck(traceText)) ?? [];
  const spansOffsetFindings =
    (spansText ? await piiCheck(spansText) : []) ?? [];

  const traceQuotes = traceOffsetFindings.map((finding) => {
    const start = finding.BeginOffset;
    const end = finding.EndOffset;
    return traceText.slice(start, end);
  });
  const spanQuotes = spansOffsetFindings.map((finding) => {
    const start = finding.BeginOffset;
    const end = finding.EndOffset;
    return spansText.slice(start, end);
  });

  return {
    quotes: traceQuotes.concat(spanQuotes),
  };
};
