import type { MonitorRepositories } from "../monitor.repositories.ts";
import { MemoryMonitorRepository } from "./memory.monitor.repository.ts";

export class MemoryMonitorRepositories {
  static readonly requires = [] as const;

  static create(): MonitorRepositories {
    return { monitors: MemoryMonitorRepository.create() };
  }
}
