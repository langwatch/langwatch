import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { execAndPipe, logFileName } from "../../src/services/_pipe-to-bus.ts";
import { EventBus } from "../../src/services/event-bus.ts";

const UPLOAD_ARTIFACT_REFUSED = /["*:<>?|\r\n]/;

describe("logFileName", () => {
  it("turns the colon of a prepare step into a dash", () => {
    expect(logFileName("prepare:langevals")).toBe("prepare-langevals.log");
  });

  it("keeps a plain service name as it is", () => {
    expect(logFileName("langwatch")).toBe("langwatch.log");
  });

  it("never yields a character actions/upload-artifact refuses", () => {
    expect(logFileName('a:b*c?d"e<f>g|h\\i/j')).not.toMatch(UPLOAD_ARTIFACT_REFUSED);
  });
});

describe("execAndPipe", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes a prepare step's output to a file name without a colon", async () => {
    dir = mkdtempSync(join(tmpdir(), "pipe-to-bus-"));
    const bus = new EventBus();
    await execAndPipe({
      bus,
      service: "prepare:langevals",
      bin: process.execPath,
      args: ["-e", "console.log('ok')"],
      logsDir: dir,
    });
    expect(readdirSync(dir)).toEqual(["prepare-langevals.log"]);
  });
});
