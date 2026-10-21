/**
 * The key one context's usage is kept under. Repository fields are compared case-folded everywhere
 * the usage is read, so they are folded here too and a remote spelled two ways stays one context; a
 * branch name is case sensitive and kept verbatim.
 */
export function contextUsageKey(context: {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
}): string {
  return [
    context.repositoryHost.toLowerCase(),
    context.repositoryOwner.toLowerCase(),
    context.repositoryName.toLowerCase(),
    context.branch,
  ].join("\0");
}

/** The key one (context, model) entry of the per-model record is kept under. */
export function modelUsageKey(usage: {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  model: string;
}): string {
  return `${contextUsageKey(usage)}\0${usage.model}`;
}
