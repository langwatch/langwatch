import { NextResponse, type NextRequest } from "next/server";
import {
  type IExportTraceServiceRequest,
  // @ts-ignore
} from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

export async function POST(req: NextRequest) {
  const body = await req.arrayBuffer();

  try {
    const traceRequest: IExportTraceServiceRequest = traceRequestType.decode(
      new Uint8Array(body)
    );
    console.log("Parsed request:", JSON.stringify(traceRequest, null, 2));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error parsing traces:", error);
    return NextResponse.json(
      { error: "Failed to parse traces" },
      { status: 400 }
    );
  }
}
