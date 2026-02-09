/**
 * Repository for SimulationSuiteConfiguration persistence.
 *
 * Handles all database operations for suite configurations.
 * Uses the Repository pattern consistent with ScenarioRepository.
 */

import type {
  Prisma,
  PrismaClient,
  SimulationSuiteConfiguration,
} from "@prisma/client";
import { nanoid } from "nanoid";

export type CreateSuiteInput = Omit<
  Prisma.SimulationSuiteConfigurationUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt" | "archivedAt"
>;

export type UpdateSuiteInput = Partial<Omit<CreateSuiteInput, "projectId">>;

export class SuiteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateSuiteInput,
  ): Promise<SimulationSuiteConfiguration> {
    return this.prisma.simulationSuiteConfiguration.create({
      data: {
        id: `suite_${nanoid()}`,
        ...input,
      },
    });
  }

  async findById(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuiteConfiguration | null> {
    return this.prisma.simulationSuiteConfiguration.findFirst({
      where: {
        id: params.id,
        projectId: params.projectId,
        archivedAt: null,
      },
    });
  }

  async findAll(params: {
    projectId: string;
  }): Promise<SimulationSuiteConfiguration[]> {
    return this.prisma.simulationSuiteConfiguration.findMany({
      where: {
        projectId: params.projectId,
        archivedAt: null,
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async update(params: {
    id: string;
    projectId: string;
    data: UpdateSuiteInput;
  }): Promise<SimulationSuiteConfiguration> {
    return this.prisma.simulationSuiteConfiguration.update({
      where: { id: params.id, projectId: params.projectId },
      data: params.data,
    });
  }

  /**
   * Soft-archive a suite by setting its archivedAt timestamp.
   * Returns the updated suite, or null if not found.
   */
  async archive(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuiteConfiguration | null> {
    const suite = await this.prisma.simulationSuiteConfiguration.findFirst({
      where: { id: params.id, projectId: params.projectId },
    });
    if (!suite) {
      return null;
    }
    return this.prisma.simulationSuiteConfiguration.update({
      where: { id: params.id, projectId: params.projectId },
      data: { archivedAt: suite.archivedAt ?? new Date() },
    });
  }
}
