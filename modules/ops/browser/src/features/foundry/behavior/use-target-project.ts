import { pickTargetProject } from "../model/target-project.ts";
import { useFoundryProjectStore } from "./foundry-project.store.ts";
import { useFoundryTransport } from "./foundry-runtime.tsx";

export function useTargetProject() {
  const { currentProject, projects } = useFoundryTransport();
  const selectedProjectId = useFoundryProjectStore((s) => s.selectedProjectId);
  return pickTargetProject({
    selectedProjectId,
    currentProjectId: currentProject?.id,
    projects,
  });
}
