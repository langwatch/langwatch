import type { CustomGraph, CustomGraphNameRef } from "@langwatch/automation-contract";

export abstract class CustomGraphRepository {
  abstract tryFindById(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null>;
  abstract existsInProject(input: { customGraphId: string; projectId: string }): Promise<boolean>;
  abstract findAllNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]>;
}
