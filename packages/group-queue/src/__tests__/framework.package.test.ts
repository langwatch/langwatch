import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GroupQueueProducer } from "../capabilities";
import { defineGroupQueue } from "../definition";
import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  readEnvelopeDescriptor,
  readJobRoutingMeta,
} from "../jobEnvelope";

describe("Group Queue framework contract", () => {
  it("builds one immutable transport definition", () => {
    const definition = defineGroupQueue({
      name: "projection-work",
      payload: {
        parse: (value: unknown) => value as { id: string; group: string },
      },
      groupBy: (value) => value.group,
      identify: (value) => value.id,
    });

    expect(definition.name).toBe("projection-work");
    expect(definition.transportName).toBe("{projection-work}");
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it("rejects an invalid transport definition", () => {
    expect(() =>
      defineGroupQueue({
        name: "invalid policy",
        payload: {
          parse: (value: unknown) => value as Record<string, unknown>,
        },
        groupBy: () => "tenant/group",
        identify: () => "job",
      }),
    ).toThrow("must use letters");
  });

  it("rejects policy values outside the runtime contract", () => {
    const definition = defineGroupQueue({
      name: "work",
      payload: {
        parse: (value: unknown) => value as { id: string; group: string },
      },
      groupBy: (value) => value.group,
      identify: (value) => value.id,
    });

    expect(
      () =>
        new GroupQueueProducer(definition, {
          redis: null as never,
          policy: { globalConcurrency: 0 },
        }),
    ).toThrow("globalConcurrency must be a positive integer");
  });

  it("round-trips the canonical envelope and reads routing from its header", async () => {
    const payload = {
      id: "event_1",
      value: "hello",
      __pipelineName: "traces",
      __jobType: "projection",
      __jobName: "summary",
    };
    const encoded = await encodeJobEnvelope({ jobData: payload });

    expect(encoded.startsWith("GQ2|")).toBe(true);
    await expect(decodeJobEnvelope({ value: encoded })).resolves.toEqual(payload);
    expect(readJobRoutingMeta(encoded)).toEqual({
      pipelineName: "traces",
      jobType: "projection",
      jobName: "summary",
    });
    expect(readEnvelopeDescriptor(encoded).version).toBe(2);
  });

  it("rejects stored values outside the canonical envelope", async () => {
    await expect(
      decodeJobEnvelope({ value: JSON.stringify({ id: "unsupported" }) }),
    ).rejects.toThrow("expected a version 2 envelope");
  });

  it("has no application, enterprise or Eventing imports", () => {
    const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const productionFiles = readdirSync(sourceRoot, {
      recursive: true,
      encoding: "utf8",
    }).filter((file) => file.endsWith(".ts") && !file.startsWith("__tests__/"));
    const source = productionFiles
      .map((file) => readFileSync(join(sourceRoot, file), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/from ["']@langwatch\/eventing/);
    expect(source).not.toMatch(/from ["']@ee/);
    expect(source).not.toMatch(/from ["']~\//);
    expect(source).not.toMatch(/platform\/app/);
  });
});
