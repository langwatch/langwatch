import { PrismaDepartmentRepository } from "../repositories/prisma/prisma-department.repository";
import { DepartmentService } from "../services/department.service";

export class PostgresDepartmentAdapter {
  private constructor(private readonly database: object) {}

  static create(options: { database: object }): PostgresDepartmentAdapter {
    return new PostgresDepartmentAdapter(options.database);
  }

  build(): DepartmentService {
    return DepartmentService.create({
      repository: PrismaDepartmentRepository.create(this.database),
    });
  }
}
