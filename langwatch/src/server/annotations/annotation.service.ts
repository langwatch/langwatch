import type { Annotation, PrismaClient } from "@prisma/client";
import {
  AnnotationRepository,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type UpdateAnnotationInput,
} from "./annotation.repository";

export class AnnotationService {
  constructor(private readonly repository: AnnotationRepository) {}

  static async create({
    prisma,
    projectId: _projectId,
  }: {
    prisma: PrismaClient;
    projectId: string;
  }): Promise<AnnotationService> {
    return new AnnotationService(new AnnotationRepository(prisma));
  }

  async create(input: CreateAnnotationInput): Promise<Annotation> {
    return this.repository.create(input);
  }

  async update(input: UpdateAnnotationInput): Promise<Annotation> {
    return this.repository.update(input);
  }

  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    return this.repository.delete(input);
  }
}
