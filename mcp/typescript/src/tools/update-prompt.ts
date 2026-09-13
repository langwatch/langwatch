import {
  getPrompt as apiGetPrompt,
  getPromptVersions as apiGetPromptVersions,
  updatePrompt as apiUpdatePrompt,
  type PromptDetailResponse,
  type PromptTag,
} from "../langwatch-api.js";

/**
 * Handles the platform_update_prompt MCP tool invocation.
 *
 * Updates an existing prompt via the PUT endpoint. Every update with a
 * commitMessage creates a new version automatically. The mutation response
 * does not carry the tags the server actually applied, so this re-fetches
 * the prompt via getPrompt: the GET response is the prompt's latest version
 * flattened to the top level (version, versionId, commitMessage) plus a
 * `tags` array of { name, versionId } naming which version each tag points
 * to. The new version is identified by matching the request's commitMessage
 * against that top level (falling back to the versions listing), and
 * deployment state is derived from the tags that point at it — never from
 * the request's tags directly.
 */
export async function handleUpdatePrompt(params: {
  idOrHandle: string;
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  commitMessage: string;
  tags?: string[];
}): Promise<string> {
  const { idOrHandle, ...data } = params;

  let updated;
  try {
    updated = await apiUpdatePrompt(idOrHandle, data);
  } catch (err) {
    // The platform commits the version before assigning tags, so a
    // rejection while tags were requested may still have created a version.
    // Re-fetch to find out rather than reporting a bare failure.
    if (params.tags && params.tags.length > 0) {
      return renderTagFailure({ idOrHandle, params });
    }
    throw err;
  }

  return renderUpdateSuccess({ idOrHandle, params, updated });
}

interface IdentifiedVersion {
  version?: number;
  versionId?: string;
}

/**
 * Finds the version created by this update. The GET detail response IS the
 * latest version, so a top-level commitMessage match identifies it directly;
 * otherwise (e.g. a concurrent update landed after ours) the versions
 * listing is consulted, best-effort.
 */
async function identifyNewVersion({
  idOrHandle,
  prompt,
  commitMessage,
}: {
  idOrHandle: string;
  prompt: PromptDetailResponse;
  commitMessage: string;
}): Promise<IdentifiedVersion | undefined> {
  if (prompt.commitMessage === commitMessage) {
    return { version: prompt.version, versionId: prompt.versionId };
  }
  try {
    const versions = await apiGetPromptVersions(idOrHandle);
    const match = (Array.isArray(versions) ? versions : []).find(
      (v) => v.commitMessage === commitMessage
    );
    if (match) return { version: match.version, versionId: match.versionId };
  } catch {
    // Identification failure is reported by the caller.
  }
  return undefined;
}

/** The prompt's deployment tags, excluding the built-in "latest" tag. */
function deploymentTagsOf(prompt: PromptDetailResponse): PromptTag[] {
  return (prompt.tags ?? []).filter((tag) => tag?.name !== "latest");
}

async function renderUpdateSuccess({
  idOrHandle,
  params,
  updated,
}: {
  idOrHandle: string;
  params: { commitMessage: string; tags?: string[] };
  updated?: { id?: string; handle?: string };
}): Promise<string> {
  let prompt;
  try {
    prompt = await apiGetPrompt(idOrHandle, {
      version: undefined,
      tag: undefined,
    });
  } catch {
    // The update itself succeeded; a failed confirmation read must not
    // surface as a tool failure — that invites a dangerous retry.
    const lines: string[] = [];
    lines.push("Prompt updated successfully!\n");
    if (updated?.id) lines.push(`**ID**: ${updated.id}`);
    if (updated?.handle) lines.push(`**Handle**: ${updated.handle}`);
    lines.push(`**Commit**: ${params.commitMessage}`);
    lines.push(
      `**Note**: the update succeeded, but version and deployment details are unavailable (confirmation read failed). Run platform_get_prompt to inspect the current state. Do not retry the update.`
    );
    return lines.join("\n");
  }

  const newVersion = await identifyNewVersion({
    idOrHandle,
    prompt,
    commitMessage: params.commitMessage,
  });

  const lines: string[] = [];
  lines.push("Prompt updated successfully!\n");
  if (prompt.id) lines.push(`**ID**: ${prompt.id}`);
  if (prompt.handle) lines.push(`**Handle**: ${prompt.handle}`);
  if (newVersion?.version != null)
    lines.push(`**Version**: v${newVersion.version}`);
  if (newVersion?.versionId)
    lines.push(`**Version ID**: ${newVersion.versionId}`);
  lines.push(`**Commit**: ${params.commitMessage}`);

  if (!newVersion) {
    // The update succeeded but the re-fetch could not identify the new
    // version by commit message — say so instead of silently omitting the
    // version and deployment lines.
    lines.push(
      `**Note**: update succeeded, but the new version could not be identified in the re-fetched prompt — version and deployment details are unavailable. Run platform_get_prompt to inspect the current state.`
    );
  }

  if (newVersion) {
    const allDeployments = deploymentTagsOf(prompt);
    const newTags = allDeployments
      .filter(
        (tag) =>
          newVersion.versionId != null &&
          tag.versionId === newVersion.versionId
      )
      .map((tag) => tag.name);
    if (newTags.length > 0) {
      lines.push(`**Deployed to**: ${newTags.join(", ")}`);
    } else {
      lines.push(`**Deployment**: not deployed`);

      // Tags pointing at other versions are untouched by this update —
      // surface them on their own line so no line pairs a version number
      // with a deployment tag name.
      const otherTags = Array.from(
        new Set(
          allDeployments
            .filter((tag) => tag.versionId !== newVersion.versionId)
            .map((tag) => tag.name)
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

async function renderTagFailure({
  idOrHandle,
  params,
}: {
  idOrHandle: string;
  params: { commitMessage: string; tags?: string[] };
}): Promise<string> {
  const failedTags = params.tags?.join(", ") ?? "";
  let prompt;
  try {
    prompt = await apiGetPrompt(idOrHandle, {
      version: undefined,
      tag: undefined,
    });
  } catch {
    // The confirmation read failed too — report the tag-assignment failure
    // without claiming whether a version was created.
    return `Prompt update failed: could not assign tag(s) ${failedTags} to "${idOrHandle}". Whether a new version was created could not be confirmed (confirmation read failed) — run platform_get_prompt before retrying.`;
  }

  const matched = await identifyNewVersion({
    idOrHandle,
    prompt,
    commitMessage: params.commitMessage,
  });

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
