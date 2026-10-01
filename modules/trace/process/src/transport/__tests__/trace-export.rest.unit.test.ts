/**
 * The HTTP door delegates export lifecycle to Trace: it only supplies the
 * authenticated actor and converts the prepared bytes into a download.
 * @vitest-environment node
 */
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { traceExportRest } from "../trace-export.rest.ts";

const boundaryErrorHandler: RestErrorHandler = (error, context) => {
  if (HandledError.isHandled(error)) {
    return context.json({ code: error.code }, (error.httpStatus ?? 500) as ContentfulStatusCode);
  }
  return context.json({ error: "internal_server_error" }, 500);
};

async function* downloadStream(contents: string): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  yield encoder.encode(contents);
}

class SignInRequiredError extends HandledError {
  constructor() {
    super("unauthenticated", "Sign in to download traces", { httpStatus: 401 });
    this.name = "SignInRequiredError";
  }
}

function buildApi({
  signedIn = true,
  permitted = true,
}: { signedIn?: boolean; permitted?: boolean } = {}) {
  const downloadTraceExport = vi.fn(async () => ({
    exportId: "export-1",
    totalCount: 2,
    stream: downloadStream("trace-1\\ntrace-2\\n"),
    cancel: async () => {},
  }));
  const app = createApiFixture<TraceApi>({ downloadTraceExport });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: { type: "user", id: "user-1" }, scope: null }),
      identify: () => {
        if (!signedIn) throw new SignInRequiredError();
        return { actor: { type: "user", id: "user-1" }, scope: null };
      },
      authorize: () => ({ permitted, organizationRole: null }),
    },
  });
  const hono = runtime.mount(traceExportRest.router(), {
    app: () => app,
    onError: boundaryErrorHandler,
  });

  return {
    download: () =>
      hono.request("http://api.test/api/export/traces/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          mode: "full",
          format: "csv",
          startDate: 0,
          endDate: 1,
          filters: {},
        }),
      }),
    downloadTraceExport,
  };
}

describe("POST /api/export/traces/download", () => {
  /** @scenario An anonymous caller is refused before anything is read */
  it("refuses a request nobody is signed in behind without reading a trace", async () => {
    const { download, downloadTraceExport } = buildApi({ signedIn: false });

    const response = await download();

    expect(response.status).toBe(401);
    expect(downloadTraceExport).not.toHaveBeenCalled();
  });

  /** @scenario A signed-in caller without permission on the project is refused */
  it("refuses a person without traces:view on the project without reading a trace", async () => {
    const { download, downloadTraceExport } = buildApi({ permitted: false });

    const response = await download();

    expect(response.status).toBe(403);
    expect(downloadTraceExport).not.toHaveBeenCalled();
  });

  /** @scenario The download is reachable on a deployment that composed it */
  it("forwards the parsed request and authenticated actor to Trace, then returns its bytes", async () => {
    const { download, downloadTraceExport } = buildApi();

    const response = await download();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("trace-1\\ntrace-2\\n");
    expect(response.headers.get("X-Export-Id")).toBe("export-1");
    expect(response.headers.get("X-Total-Traces")).toBe("2");
    const today = nowInstant().toString().slice(0, 10);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="project-1 - Traces - ${today} - full.csv"`,
    );
    expect(downloadTraceExport).toHaveBeenCalledWith({
      userId: "user-1",
      request: expect.objectContaining({ projectId: "project-1", mode: "full", format: "csv" }),
    });
  });
});
