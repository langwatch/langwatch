import { beforeAll, describe, expect, it } from "vitest";
import { setup } from "src/client-node";
import { getLangWatchTracer } from "../../trace";

const tracerName = "basic-observability.test";

describe("basic observability tests around tracing", () => {
  beforeAll(async () => {
    await setup();
  });

  it("traces should be sent", async () => {
    const tracer = getLangWatchTracer(tracerName);
    await tracer.withActiveSpan(
      "basic trace",
      async () => { },
    );
  });

  it("traces should be sent with complex arguments", async () => {
    const tracer = getLangWatchTracer(tracerName);
    await tracer.withActiveSpan(
      "complex argument trace",
      { attributes: { foo: "bar" }, root: true },
      async (span) => {
        span.setAttributes({
          bar: "bas",
        });
        span.addEvent("test event", {
          foo: "bar",
        });
      },
    );
  });

  it("traces exceptions", async () => {
    const tracer = getLangWatchTracer(tracerName);

    await expect(
      tracer.withActiveSpan(
        "trace exception",
        async () => {
          throw new Error("this is meant to error");
        },
      )
    ).rejects.toThrow("this is meant to error");
  });

  it("traces handle complex nesting", async () => {
    const tracer = getLangWatchTracer(tracerName);
    await tracer.withActiveSpan(
      "complex nesting trace",
      async () => {
        await tracer.withActiveSpan(
          "nested trace alpha",
          async () => { },
        );
        await tracer.withActiveSpan(
          "nested trace beta",
          async () => { },
        );
        await tracer.withActiveSpan(
          "nested trace gamma",
          async () => {
            await tracer.withActiveSpan(
              "nested trace gamma child",
              async () => { },
            );
          },
        );
      },
    );
  });
});
