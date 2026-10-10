import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

/**
 * Decides the calls a created prompt raises.
 * @param userId - The org admin user ID
 * @param projectId - The project where the prompt was created
 * @param orgPromptCount - The org-wide prompt count AFTER the prompt was created
 */
export function firePromptCreated({
  userId,
  projectId,
  orgPromptCount,
}: {
  userId: string;
  projectId: string;
  orgPromptCount: number;
}): CioBatchCall[] {
  const calls: CioBatchCall[] = [
    { type: "identify", userId, traits: { has_prompts: true, prompt_count: orgPromptCount } },
  ];

  if (orgPromptCount === 1) {
    calls.push({
      type: "track",
      userId,
      event: "first_prompt_created",
      properties: { project_id: projectId },
    });
  }

  return calls;
}
