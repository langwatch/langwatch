import {
  PrismaDepartmentRepository,
  type DepartmentDatabase,
} from "../repositories/prisma/prisma.department.repository.ts";
import { DepartmentService } from "../services/department.service.ts";

export class PostgresDepartmentAdapter {
  private constructor(private readonly database: DepartmentDatabase) {}

  static create(options: { database: DepartmentDatabase }): PostgresDepartmentAdapter {
    return new PostgresDepartmentAdapter(options.database);
  }

  build(): DepartmentService {
    return DepartmentService.create({
      repository: PrismaDepartmentRepository.create(this.database),
    });
  }
}
