import { TraceAnnotationScoresReadRepository } from "../trace-annotation-scores.repository.ts";

/** A score definition as a test seeds it, with the project that owns it. */
type SeededScore = { projectId: string; id: string; name: string };

/** Annotation's shared `AnnotationScore` rows in memory, seeded by a test; trace writes none. */
export class MemoryTraceAnnotationScoresRepository extends TraceAnnotationScoresReadRepository {
  static create({
    scores = [],
  }: { scores?: readonly SeededScore[] } = {}): MemoryTraceAnnotationScoresRepository {
    return new MemoryTraceAnnotationScoresRepository(scores);
  }

  private constructor(private readonly scores: readonly SeededScore[]) {
    super();
  }

  async findScoreNames({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.scores
      .filter((score) => score.projectId === projectId)
      .map(({ id, name }) => ({ id, name }));
  }
}
