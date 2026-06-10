import { createProject as apiCreateProject } from "../langwatch-api-projects.js";

export async function handleCreateProject(params: {
  name: string;
  language: string;
  framework: string;
  teamId?: string;
  newTeamName?: string;
}): Promise<string> {
  if (!params.teamId && !params.newTeamName) {
    return "Error: You must provide either `teamId` (to add to an existing team) or `newTeamName` (to create a new team for this project).";
  }

  const result = await apiCreateProject({
    name: params.name,
    language: params.language,
    framework: params.framework,
    teamId: params.teamId,
    newTeamName: params.newTeamName,
  });

  if (!result.serviceApiKey) {
    throw new Error(
      "API did not return a service API key. The project was created but the key is missing — check the LangWatch UI.",
    );
  }

  const lines: string[] = [];
  lines.push(`Project created successfully!\n`);
  lines.push(`**Name**: ${result.name}`);
  lines.push(`**ID**: ${result.id}`);
  lines.push(`**Slug**: ${result.slug}`);
  lines.push(`**Language**: ${result.language}`);
  lines.push(`**Framework**: ${result.framework}`);
  lines.push("");
  lines.push(`**Service API Key**: \`${result.serviceApiKey}\``);
  lines.push(`**Service API Key ID**: ${result.serviceApiKeyId}`);
  lines.push("");
  lines.push(
    "> ⚠️ Save the service API key now — it will not be shown again. " +
    "Use it as `LANGWATCH_API_KEY` to authenticate project-scoped operations.",
  );

  return lines.join("\n");
}
