import type { GithubPullRequestEvent } from "@langwatch/github-contract";
import { z } from "zod";

import { GithubPullRequestEventPort } from "../ports/github-pull-request-event.port";

const githubPullRequestEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.union([z.number(), z.string()]) }).nullish(),
  repository: z.object({
    name: z.string().min(1),
    full_name: z.string().min(1),
    owner: z.object({ login: z.string().min(1) }),
  }),
  pull_request: z.object({
    number: z.number(),
    html_url: z.string(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean().optional(),
    merged_at: z.string().nullish(),
    closed_at: z.string().nullish(),
    created_at: z.string(),
    updated_at: z.string().datetime({ offset: true }),
    user: z.object({ login: z.string().optional() }).nullish(),
    head: z.object({
      ref: z.string().min(1),
      repo: z.object({ full_name: z.string() }).nullish(),
    }),
  }),
});

export class GithubPullRequestEventAdapter extends GithubPullRequestEventPort {
  static create(): GithubPullRequestEventAdapter {
    return new GithubPullRequestEventAdapter();
  }

  private constructor() {
    super();
  }

  tryParse(payload: unknown): GithubPullRequestEvent | null {
    const parsed = githubPullRequestEventSchema.safeParse(payload);
    if (!parsed.success) {
      return null;
    }

    const { action, installation, repository, pull_request: pull } = parsed.data;
    const headRepository = pull.head.repo?.full_name;
    if (installation?.id == null || !headRepository) {
      return null;
    }
    if (headRepository.toLowerCase() !== repository.full_name.toLowerCase()) {
      return null;
    }

    return {
      action,
      installationId: String(installation.id),
      repositoryOwner: repository.owner.login,
      repositoryName: repository.name,
      headBranch: pull.head.ref,
      pullRequest: {
        number: pull.number,
        htmlUrl: pull.html_url,
        title: pull.title,
        state: pull.state,
        draft: pull.draft ?? false,
        mergedAt: pull.merged_at ?? null,
        closedAt: pull.closed_at ?? null,
        createdAt: pull.created_at,
        updatedAt: pull.updated_at,
        authorLogin: pull.user?.login ?? null,
      },
    };
  }
}
