// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import { MemoryNurturingUncopiedProjectRepository } from "../../repositories/memory/memory.nurturing-uncopied-project.repository.ts";
import { NurturingCopiedProjectsService } from "../nurturing-copied-projects.service.ts";
import { NurturingTraceCountingService } from "../nurturing-trace-counting.service.ts";
import { NurturingUncopiedProjectsService } from "../nurturing-uncopied-projects.service.ts";

/**
 * The trace counts' dependencies: project-1 in org-1, created `createdAt`, once `copied` in
 * nurturing's placement copy and, once `organizationCopied`, in its creation copy; any other
 * project is never placed. Uncopied projects go through nurturing's own retry-or-drop service, on a
 * clock the test moves by hand.
 */
export function countingOver({
  createdAt,
  traceDays = MemoryNurturingTraceDayRepository.create(),
  copied = true,
  organizationCopied = copied,
}: {
  createdAt: number;
  traceDays?: MemoryNurturingTraceDayRepository;
  copied?: boolean;
  organizationCopied?: boolean;
}) {
  const placements = MemoryNurturingProjectPlacementRepository.create({
    placed: new Map(copied ? [["project-1", "org-1"]] : []),
  });
  const organizationsCreated = MemoryNurturingOrganizationCreatedRepository.create({
    createdAt: new Map(organizationCopied ? [["org-1", createdAt]] : []),
  });
  let now = createdAt;
  const uncopiedProjects = NurturingUncopiedProjectsService.create({
    uncopiedProjects: MemoryNurturingUncopiedProjectRepository.create(),
    clock: { nowMs: () => now },
  });
  const service = NurturingTraceCountingService.create({
    traceDays,
    copiedProjects: NurturingCopiedProjectsService.create({ placements, organizationsCreated }),
    uncopiedProjects,
  });
  return {
    traceDays,
    placements,
    organizationsCreated,
    uncopiedProjects,
    countTraces: (input: Parameters<NurturingTraceCountingService["countTraces"]>[0]) =>
      service.countTraces(input),
    /** Moves the uncopied projects' clock on. */
    advance: (ms: number) => {
      now += ms;
    },
    /**
     * The copies' subscribers catch up, the placement's forgetting the project as uncopied; on
     * another worker, this one's cached drop is left as it was.
     */
    landCopies: async ({ onThisWorker = true }: { onThisWorker?: boolean } = {}) => {
      await placements.recordProject({ projectId: "project-1", organizationId: "org-1" });
      if (onThisWorker) await uncopiedProjects.copyLanded({ projectId: "project-1" });
      await organizationsCreated.recordOrganizationCreated({ organizationId: "org-1", createdAt });
    },
  };
}
