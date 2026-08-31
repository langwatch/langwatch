import {
  getPrompt as apiGetPrompt,
  updatePrompt as apiUpdatePrompt,
  type PromptVersion,
} from "../langwatch-api.js";

/**
 * Handles the platform_update_prompt MCP tool invocation.
 *
 * Updates an existing prompt via the PUT endpoint. Every update with a
 * commitMessage creates a new version automatically. The mutation response
 * does not carry the tags the server actually applied to that version, so
 * this re-fetches the prompt via getPrompt and derives the reported
 * versionId and deployment state from the matching version's own tags
 * (matched by commitMessage) — never from the request's tags directly.
 */
export async function handleUpdatePrompt(params: {
  idOrHandle: string;
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  commitMessage: string;
  tags?: string[];
}): Promise<string> {
  const { idOrHandle, ...data } = params;

  try {
    await apiUpdatePrompt(idOrHandle, data);
  } catch (err) {
    // The platform commits the version before assigning tags, so a
    // rejection while tags were requested may still have created a version.
    // Re-fetch to find out rather than reporting a bare failure.
    if (params.tags && params.tags.length > 0) {
      return renderTagFailure(idOrHandle, params);
    }
    throw err;
  }

  return renderUpdateSuccess(idOrHandle, params);
}

function findVersionByCommitMessage(
  versions: PromptVersion[],
  commitMessage: string
): PromptVersion | undefined {
  return versions.find((v) => v.commitMessage === commitMessage);
}

/** A version's own deployment tags, excluding the built-in "latest" tag. */
function deploymentTagsOf(version: PromptVersion | undefined): string[] {
  return (version?.tags ?? []).filter((tag) => tag !== "latest");
}

async function renderUpdateSuccess(
  idOrHandle: string,
  params: { commitMessage: string; tags?: string[] }
): Promise<string> {
  const prompt = await apiGetPrompt(idOrHandle, {
    version: undefined,
    tag: undefined,
  });
  const versions = prompt.versions ?? [];
  const newVersion = findVersionByCommitMessage(versions, params.commitMessage);

  const lines: string[] = [];
  lines.push("Prompt updated successfully!\n");
  if (prompt.id) lines.push(`**ID**: ${prompt.id}`);
  if (prompt.handle) lines.push(`**Handle**: ${prompt.handle}`);
  if (newVersion?.version != null)
    lines.push(`**Version**: v${newVersion.version}`);
  if (newVersion?.versionId)
    lines.push(`**Version ID**: ${newVersion.versionId}`);
  lines.push(`**Commit**: ${params.commitMessage}`);

  if (newVersion) {
    const newTags = deploymentTagsOf(newVersion);
    if (newTags.length > 0) {
      lines.push(`**Deployed to**: ${newTags.join(", ")}`);
    } else {
      lines.push(`**Deployment**: not deployed`);

      // Other versions' deployment tags are untouched by this update —
      // surface them on their own line so no line pairs a version number
      // with a deployment tag name.
      const otherTags = Array.from(
        new Set(
          versions
            .filter((v) => v !== newVersion)
            .flatMap((v) => deploymentTagsOf(v))
        )
      );
      if (otherTags.length > 0) {
        lines.push(
          `**Existing deployments (untouched)**: ${otherTags.join(", ")}`
        );
      }
    }
  }

  return lines.join("\n");
}

async function renderTagFailure(
  idOrHandle: string,
  params: { commitMessage: string; tags?: string[] }
): Promise<string> {
  const prompt = await apiGetPrompt(idOrHandle, {
    version: undefined,
    tag: undefined,
  });
  const versions = prompt.versions ?? [];
  const matched = findVersionByCommitMessage(versions, params.commitMessage);
  const failedTags = params.tags?.join(", ") ?? "";

  if (matched) {
    const lines: string[] = [];
    lines.push("Prompt update partially failed.\n");
    lines.push(
      "A new version was created, but assigning the requested tag(s) failed."
    );
    if (matched.versionId) lines.push(`**Version ID**: ${matched.versionId}`);
    lines.push(`**Status**: created, untagged`);
    lines.push(`**Failed tag(s)**: ${failedTags}`);
    return lines.join("\n");
  }

  return `Prompt update failed: could not assign tag(s) ${failedTags} to "${idOrHandle}".`;
}
