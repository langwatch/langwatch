/** Spec: modules/automation/specs/automation.feature (the JSON-text step) */
import type { CreateTriggerCommand } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { MemoryAutomationStore } from "../../repositories/memory/memory.automation.store.ts";
import { MemoryTriggerRepository } from "../../repositories/memory/memory.trigger.repository.ts";
import type { TriggerJsonColumn } from "../../repositories/trigger.repository.ts";
import {
  TriggerJsonTextUnwrapService,
  type TriggerJsonTextCheckpoint,
} from "../trigger-json-text-unwrap.service.ts";

const PROJECT = "project-1";
/** The service's page size: one more trigger than this spans two pages. */
const PAGE = 500;

function setup() {
  const store = MemoryAutomationStore.create();
  const triggers = MemoryTriggerRepository.create(store);
  const service = TriggerJsonTextUnwrapService.create({ triggers });

  /** A trigger an earlier release saved, with the given columns stored as JSON text. */
  const legacy = async (id: string, text: Partial<Record<TriggerJsonColumn, string>>) => {
    await triggers.create({
      id,
      projectId: PROJECT,
      name: `Alert ${id}`,
      action: "SEND_EMAIL",
      actionParams: {},
      filters: {},
    } satisfies CreateTriggerCommand);
    store.triggerJsonText.set(id, text);
  };

  const run = async ({
    dryRun = false,
    from,
  }: { dryRun?: boolean; from?: TriggerJsonTextCheckpoint } = {}) => {
    const saves: TriggerJsonTextCheckpoint[] = [];
    const report = await service.unwrap({
      dryRun,
      ...(from ? { from } : {}),
      onPage: async (checkpoint) => void saves.push(checkpoint),
    });
    return { report, saves };
  };

  const read = (id: string) => triggers.findById({ triggerId: id, projectId: PROJECT });

  return { store, triggers, legacy, run, read };
}

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `trigger-${String(index).padStart(4, "0")}`);

describe("TriggerJsonTextUnwrapService", () => {
  describe("given triggers whose columns hold a JSON object as JSON text", () => {
    /** @scenario "The JSON-text step unwraps text that encodes a JSON object" */
    it("stores the objects that text encodes and counts each column", async () => {
      const { store, legacy, run, read } = setup();
      await legacy("a", {
        filters: '{"topics":["x"]}',
        actionParams: '{"members":["ada@x.test"]}',
      });
      await legacy("b", { actionParams: '{"url":"https://hooks.example.com"}' });

      const { report } = await run();

      expect(report).toEqual({ unwrapped: 3, leftAlone: 0, changed: 0, unparseable: 0 });
      expect(await read("a")).toMatchObject({
        filters: { topics: ["x"] },
        actionParams: { members: ["ada@x.test"] },
      });
      expect((await read("b"))?.actionParams).toEqual({ url: "https://hooks.example.com" });
      expect([...store.triggerJsonText.values()]).toEqual([{}, {}]);
    });

    /** @scenario "Running the JSON-text step twice unwraps nothing the second time" */
    it("unwraps nothing on a second run", async () => {
      const { legacy, run, read } = setup();
      await legacy("a", { filters: '{"topics":["x"]}' });
      await run();
      const before = await read("a");

      const { report, saves } = await run();

      expect(report).toEqual({ unwrapped: 0, leftAlone: 0, changed: 0, unparseable: 0 });
      expect(saves).toEqual([]);
      expect(await read("a")).toEqual(before);
    });

    /** @scenario "The JSON-text step's dry run writes nothing" */
    it("writes and saves nothing on a dry run, and counts what it would unwrap", async () => {
      const { store, legacy, run } = setup();
      await legacy("a", { filters: '{"topics":["x"]}', actionParams: "not json" });

      const { report, saves } = await run({ dryRun: true });

      expect(report).toEqual({ unwrapped: 1, leftAlone: 1, changed: 0, unparseable: 0 });
      expect(saves).toEqual([]);
      expect(store.triggerJsonText.get("a")).toEqual({
        filters: '{"topics":["x"]}',
        actionParams: "not json",
      });
    });
  });

  describe("given text that is not a JSON object", () => {
    /** @scenario "The JSON-text step leaves text that is not a JSON object" */
    it.each(["[1,2]", "not json", "42", "null", '"x"', ""])(
      "leaves %j as text and counts it as left alone",
      async (text) => {
        const { store, legacy, run } = setup();
        await legacy("a", { filters: text });

        const { report } = await run();

        expect(report).toEqual({ unwrapped: 0, leftAlone: 1, changed: 0, unparseable: 0 });
        expect(store.triggerJsonText.get("a")).toEqual({ filters: text });
      },
    );

    /** @scenario "The JSON-text step leaves text that is not a JSON object" */
    it("does not touch a column that already holds an object", async () => {
      const { triggers, legacy, run, read } = setup();
      await legacy("a", { filters: "[1]" });
      await triggers.update({ id: "a", projectId: PROJECT, actionParams: { k: 1 } });

      await run();

      expect((await read("a"))?.actionParams).toEqual({ k: 1 });
    });
  });

  describe("given text the database will not store as jsonb", () => {
    /** @scenario "The JSON-text step leaves text the database cannot store as an object" */
    it("counts it as unparseable, leaves it, and goes on to the next column", async () => {
      const { store, legacy, run } = setup();
      const nul = String.raw`{"name":"a\u0000b"}`;
      await legacy("a", { filters: nul, actionParams: '{"k":1}' });

      const { report } = await run();

      expect(report).toEqual({ unwrapped: 1, leftAlone: 0, changed: 0, unparseable: 1 });
      expect(store.triggerJsonText.get("a")).toEqual({ filters: nul });
    });
  });

  describe("given another writer saved the column after the step read it", () => {
    /** @scenario "The JSON-text step leaves a row another writer changed" */
    it("keeps the other writer's value and counts the column as changed", async () => {
      const { triggers, legacy, read } = setup();
      await legacy("a", { filters: '{"old":true}' });
      const racing = {
        findJsonTextPage: async (input: { after?: string; limit: number }) => {
          const page = await triggers.findJsonTextPage(input);
          await triggers.update({ id: "a", projectId: PROJECT, filters: { new: true } });
          return page;
        },
        unwrapJsonText: triggers.unwrapJsonText.bind(triggers),
      };

      const report = await TriggerJsonTextUnwrapService.create({ triggers: racing }).unwrap({
        dryRun: false,
      });

      expect(report).toEqual({ unwrapped: 0, leftAlone: 0, changed: 1, unparseable: 0 });
      expect((await read("a"))?.filters).toEqual({ new: true });
    });
  });

  describe("given more triggers with JSON text than one page holds", () => {
    /** @scenario "The JSON-text step works in pages and resumes after the last page it finished" */
    it("saves a checkpoint after each page, the last id it finished and the counts so far", async () => {
      const { legacy, run } = setup();
      const all = ids(PAGE + 3);
      for (const id of all) await legacy(id, { filters: '{"a":1}' });

      const { report, saves } = await run();

      expect(report).toEqual({ unwrapped: PAGE + 3, leftAlone: 0, changed: 0, unparseable: 0 });
      expect(saves).toEqual([
        { after: all[PAGE - 1], unwrapped: PAGE, leftAlone: 0, changed: 0, unparseable: 0 },
        { after: all.at(-1), unwrapped: PAGE + 3, leftAlone: 0, changed: 0, unparseable: 0 },
      ]);
    });

    /** @scenario "The JSON-text step works in pages and resumes after the last page it finished" */
    it("resumes after the checkpoint's last trigger, carrying its counts", async () => {
      const { store, legacy, run } = setup();
      const all = ids(PAGE + 3);
      for (const id of all) await legacy(id, { filters: '{"a":1}' });
      const checkpoint = {
        after: all[PAGE - 1] ?? "",
        unwrapped: PAGE,
        leftAlone: 0,
        changed: 0,
        unparseable: 0,
      };

      const { report } = await run({ from: checkpoint });

      expect(report).toEqual({ unwrapped: PAGE + 3, leftAlone: 0, changed: 0, unparseable: 0 });
      expect(store.triggerJsonText.get(all[0] ?? "")).toEqual({ filters: '{"a":1}' });
      expect(store.triggerJsonText.get(all.at(-1) ?? "")).toEqual({});
    });
  });
});
