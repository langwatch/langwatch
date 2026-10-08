// @vitest-environment node
import { EventEmitter } from "node:events";
import process from "node:process";

import { generate, getEnvironment, setEnvironment } from "@langwatch/ksuid";
import { afterEach, describe, expect, it } from "vitest";

import { Server } from "../preamble.ts";
import { setProcessGlobals } from "../process-globals.ts";

const before = {
  environment: getEnvironment(),
  processListeners: process.getMaxListeners(),
  defaultListeners: EventEmitter.defaultMaxListeners,
};

afterEach(() => {
  setEnvironment(before.environment);
  process.setMaxListeners(before.processListeners);
  EventEmitter.defaultMaxListeners = before.defaultListeners;
});

describe("process globals", () => {
  /** @scenario "A process that owns its Node process mints ids carrying its environment prefix" */
  it("stamps the environment prefix when the preamble owns the process", async () => {
    const server = await Server.create("process-globals-test")
      .withEnvironment({ ENVIRONMENT: "staging" })
      .start();
    try {
      expect(generate("trace").toString()).toMatch(/^staging_trace_/);
    } finally {
      await server.close();
    }
  });

  /** @scenario "A process started without ENVIRONMENT mints local ids, as main did" */
  it("defaults the prefix to local", () => {
    setProcessGlobals({ environment: {} });

    expect(generate("trace").toString()).toMatch(/^local_trace_/);
  });

  /** @scenario "A preamble that does not own its Node process leaves the id environment alone" */
  it("leaves the id environment alone when the preamble does not own the process", async () => {
    const server = await Server.create("process-globals-test")
      .withEnvironment({ ENVIRONMENT: "staging" })
      .withProcessOwnership(false)
      .start();
    try {
      expect(getEnvironment()).toBe(before.environment);
    } finally {
      await server.close();
    }
  });

  /** @scenario "A production process raises the listener ceiling to 128, as main did" */
  it("raises the listener ceiling in production only", () => {
    setProcessGlobals({ environment: { NODE_ENV: "production" } });

    expect(process.getMaxListeners()).toBe(128);
    expect(new EventEmitter().getMaxListeners()).toBe(128);
  });
});
