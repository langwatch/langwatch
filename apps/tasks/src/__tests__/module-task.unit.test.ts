import { Task } from "@langwatch/task";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runModuleTask } from "../module-task.ts";

class RecordingTask extends Task {
  readonly description = "records that it ran";

  constructor(
    readonly name: string,
    private readonly ran: string[],
  ) {
    super();
  }

  async run(): Promise<void> {
    this.ran.push(this.name);
  }
}

const booted = vi.hoisted(() => ({ ran: new Array<string>(), app: { tasks: vi.fn() } }));

vi.mock("../process-modules.generated.ts", () => ({ processModules: [] }));
vi.mock("@langwatch/process", async (importOriginal) => {
  const actual = await importOriginal<object>();
  const server = {
    container: () => ({ boot: async () => booted.app }),
    run: async () => void 0,
    close: async () => void 0,
  };
  const preamble = {
    withEnvironment: () => preamble,
    withConfig: () => preamble,
    withSecrets: () => preamble,
    withProcessOwnership: () => preamble,
    start: async () => server,
  };
  return { ...actual, processConfig: () => [], Server: { create: () => preamble } };
});

beforeEach(() => {
  booted.ran.length = 0;
  booted.app.tasks.mockReturnValue([new RecordingTask("installed", booted.ran)]);
});

describe("given a module task run", () => {
  describe("when LANGWATCH_TASK_MODULES names a module exporting createTasks", () => {
    /** @scenario "The tasks process hands a plugin's createTasks the booted App" */
    it("hands the factory the booted App and runs its task from the catalogue", async () => {
      const createTasks = vi.fn(() => [new RecordingTask("plugin", booted.ran)]);
      const importModule = vi.fn(async () => ({ createTasks }));

      await runModuleTask({
        name: "plugin",
        args: [],
        signal: new AbortController().signal,
        plugins: { taskModules: " @acme/tasks ", importModule },
      });

      expect(importModule).toHaveBeenCalledWith("@acme/tasks");
      expect(createTasks).toHaveBeenCalledWith(booted.app);
      expect(booted.ran).toEqual(["plugin"]);
    });
  });

  describe("when no plugin module is named", () => {
    it("runs an installed module's task and imports nothing", async () => {
      const importModule = vi.fn(async () => ({}));

      await runModuleTask({
        name: "installed",
        args: [],
        signal: new AbortController().signal,
        plugins: { taskModules: undefined, importModule },
      });

      expect(importModule).not.toHaveBeenCalled();
      expect(booted.ran).toEqual(["installed"]);
    });
  });
});
