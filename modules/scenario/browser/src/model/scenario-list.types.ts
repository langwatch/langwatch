import type { Instant } from "@langwatch/time";

export type ScenarioListItem = {
  id: string;
  name: string;
  labels: string[];
  updatedAt: Instant;
};

export type ScenarioArchiveItem = {
  id: string;
  name: string;
};
