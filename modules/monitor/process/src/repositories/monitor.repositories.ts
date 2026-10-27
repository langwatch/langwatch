import type { MonitorRepository } from "./monitor.repository.ts";

export interface MonitorRepositories {
  readonly monitors: MonitorRepository;
}
