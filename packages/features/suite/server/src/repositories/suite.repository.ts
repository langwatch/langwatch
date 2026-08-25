import type {
  CreateSuiteCommand,
  Suite,
  SuiteIdInput,
  UpdateSuiteCommand,
} from "@langwatch/suite-contract";

export abstract class SuiteRepository {
  abstract create(
    input: CreateSuiteCommand & { id: string; slug: string },
  ): Promise<Suite>;
  abstract list(input: { projectId: string }): Promise<Suite[]>;
  abstract tryFindById(input: SuiteIdInput): Promise<Suite | null>;
  abstract tryFindBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<Suite | null>;
  abstract update(input: UpdateSuiteCommand & { slug?: string }): Promise<Suite>;
  abstract archive(
    input: SuiteIdInput & { archivedAt: Date; archivedSlug: string },
  ): Promise<Suite>;
}
