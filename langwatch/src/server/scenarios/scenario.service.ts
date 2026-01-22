import type { PrismaClient } from "@prisma/client";
import { ScenarioRepository } from "./scenario.repository";

export class ScenarioService {
  constructor(private readonly repository: ScenarioRepository) {}

  static create(prisma: PrismaClient): ScenarioService {
    return new ScenarioService(new ScenarioRepository(prisma));
  }

  get create() {
    return this.repository.create.bind(this.repository);
  }

  get getById() {
    return this.repository.findById.bind(this.repository);
  }

  get getAll() {
    return this.repository.findAll.bind(this.repository);
  }

  get update() {
    return this.repository.update.bind(this.repository);
  }
}
