/** Every call needs scenarios:create; creating an agent also needs evaluations:manage (#8021). */
export function voicePermissionsFor({
  createsAgent,
}: {
  createsAgent: boolean;
}): readonly ("scenarios:create" | "evaluations:manage")[] {
  return createsAgent ? ["scenarios:create", "evaluations:manage"] : ["scenarios:create"];
}
