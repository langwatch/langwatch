import type {
  CreateSuiteCommand,
  Suite,
  SuiteIdInput,
  UpdateSuiteCommand,
} from "@langwatch/suite-contract";

export abstract class SuiteRepository {
  abstract create(input: CreateSuiteCommand & { id: string; slug: string }): Promise<Suite>;
  abstract list(input: { projectId: string }): Promise<Suite[]>;
  abstract resolveDynamicRunMembership(input: SuiteIdInput): Promise<string[]>;
  abstract tryFindById(input: SuiteIdInput): Promise<Suite | null>;
  abstract tryFindBySlug(input: { projectId: string; slug: string }): Promise<Suite | null>;
  abstract saveManagedRunAll(input: {
    id: string;
    projectId: string;
    name: string;
    baseSlug: string;
    label: string;
    scenarioIds: string[];
    targets?: Suite["targets"];
  }): Promise<Suite>;
  abstract update(input: UpdateSuiteCommand & { slug?: string }): Promise<Suite>;
  abstract archive(
    input: SuiteIdInput & { archivedAt: Date; archivedSlug: string },
  ): Promise<Suite>;
}
