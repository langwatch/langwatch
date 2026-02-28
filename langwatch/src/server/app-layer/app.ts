import { createLogger } from "~/utils/logger/server";
import { EventSourcing } from "../event-sourcing/eventSourcing";
import type { AppCommands } from "../event-sourcing/pipelineRegistry";
import type { AppConfig } from "./config";
import type { AppDependencies } from "./dependencies";

const logger = createLogger("langwatch:app");

export class App {
  readonly config: AppConfig;

  readonly broadcast: AppDependencies["broadcast"];
  readonly traces: AppDependencies["traces"] & AppCommands["traces"];
  readonly evaluations: AppDependencies["evaluations"] &
    AppCommands["evaluations"];
  readonly experimentRuns: AppCommands["experimentRuns"];
  readonly simulations: AppCommands["simulations"];
  readonly organizations: AppDependencies["organizations"];
  readonly projects: AppDependencies["projects"];
  readonly tokenizer: AppDependencies["tokenizer"];
  readonly usage: AppDependencies["usage"];
  readonly planProvider: AppDependencies["planProvider"];
  readonly subscription?: AppDependencies["subscription"];

  /** Keeps EventSourcing infrastructure safe from the greedy garbage men */
  private readonly _eventSourcing?: EventSourcing;
  private readonly _gracefulCloseables: Array<{
    name: string;
    close: () => Promise<void>;
  }>;

  constructor(deps: AppDependencies) {
    this.config = deps.config;
    this.organizations = deps.organizations;
    this.projects = deps.projects;
    this.tokenizer = deps.tokenizer;
    this.usage = deps.usage;
    this.planProvider = deps.planProvider;
    this.subscription = deps.subscription;
    this.broadcast = deps.broadcast;
    this.traces = { ...deps.traces, ...deps.commands.traces };
    this.evaluations = { ...deps.evaluations, ...deps.commands.evaluations };
    this.experimentRuns = deps.commands.experimentRuns;
    this.simulations = deps.commands.simulations;
    this._eventSourcing = deps._eventSourcing;
    this._gracefulCloseables = deps._gracefulCloseables ?? [];
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      (async () => {
        if (this._eventSourcing) {
          try {
            await this._eventSourcing.close();
          } catch (error) {
            logger.error({ error }, "Failed to close EventSourcing");
          }
        }
      })(),
      ...this._gracefulCloseables.map(async (c) => {
        try {
          await c.close();
        } catch (error) {
          logger.error({ name: c.name, error }, "Failed to close");
        }
      }),
    ]);
  }
}

// Global access, thx turbopacc
export const globalForApp = globalThis as unknown as { __langwatch_app: App | null };
if (globalForApp.__langwatch_app === void 0) {
  globalForApp.__langwatch_app = null;
}

export function initializeApp(deps: AppDependencies): App {
  if (!globalForApp.__langwatch_app) {
    globalForApp.__langwatch_app = new App(deps);
  }
  return globalForApp.__langwatch_app;
}

export function getApp(): App {
  if (!globalForApp.__langwatch_app) {
    throw new Error("App not initialized. Call initializeDefaultApp() first.");
  }
  return globalForApp.__langwatch_app;
}

export function resetApp(): void {
  globalForApp.__langwatch_app = null;
}
