import {
  SHARE_KSUID_RESOURCE,
  shareLinkSchema,
  shareWithProjectSchema,
  type ShareLink,
  type ShareResourceType,
  type ShareWithProject,
} from "@langwatch/share-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate, type Instant } from "@langwatch/time";
import type {
  ConsumeShareViewParams,
  CreateShareLinkParams,
  ShareLinkScope,
  ShareRepository,
  ShareResourceScope,
  ShareTraceSharingConfig,
} from "../share.repository.ts";
import { MemoryShareDatabase } from "./memory.share.database.ts";

function isActive(link: ShareLink, now: Instant): boolean {
  return link.expiresAt === null || link.expiresAt.getTime() > now.epochMilliseconds;
}

export class MemoryShareRepository implements ShareRepository {
  #database: MemoryShareDatabase;

  private constructor(database: MemoryShareDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ memory: MemoryShareDatabase }>): MemoryShareRepository {
    return new MemoryShareRepository(input.memory);
  }

  async findTraceSharingConfig(projectId: string): Promise<ShareTraceSharingConfig | null> {
    const project = this.#database.project(projectId);
    if (!project) return null;

    return {
      orgEnabled: project.organizationTraceSharingEnabled,
      projectEnabled: project.traceSharingEnabled,
    };
  }

  async findByToken(token: string): Promise<ShareWithProject | null> {
    const link = this.#database.links.find((row) => row.token === token);

    return link ? shareWithProjectSchema.parse(this.#database.withProject(link)) : null;
  }

  async findById({ id, projectId }: ShareLinkScope): Promise<ShareWithProject | null> {
    const link = this.#database.link(id, projectId);

    return link ? shareWithProjectSchema.parse(this.#database.withProject(link)) : null;
  }

  async existsById({ id, projectId }: ShareLinkScope): Promise<boolean> {
    return this.#database.link(id, projectId) !== void 0;
  }

  async findAllByResource(scope: ShareResourceScope): Promise<ShareLink[]> {
    return this.#matching(scope)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((link) => shareLinkSchema.parse(link));
  }

  async countActiveForResource(scope: ShareResourceScope): Promise<number> {
    const now = nowInstant();

    return this.#matching(scope).filter((link) => isActive(link, now)).length;
  }

  async create(params: CreateShareLinkParams): Promise<ShareLink> {
    const now = toDate(nowInstant());
    const link = shareLinkSchema.parse({
      id: generate(SHARE_KSUID_RESOURCE).toString(),
      token: params.token,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      threadId: null,
      projectId: params.projectId,
      userId: params.userId ?? null,
      visibility: params.visibility ?? "PUBLIC",
      expiresAt: params.expiresAt ? toDate(params.expiresAt) : null,
      maxViews: params.maxViews ?? null,
      viewCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    this.#database.links.push(link);

    return structuredClone(link);
  }

  async consumeView({ id, projectId, maxViews }: ConsumeShareViewParams): Promise<boolean> {
    const link = this.#database.link(id, projectId);
    if (!link) return false;
    if (maxViews != null && link.viewCount >= maxViews) return false;

    link.viewCount += 1;

    return true;
  }

  async findAllIdsByResource({
    projectId,
    resourceType,
    resourceId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId?: string;
  }): Promise<string[]> {
    return this.#database.links
      .filter(
        (link) =>
          link.projectId === projectId &&
          link.resourceType === resourceType &&
          (resourceId === void 0 || link.resourceId === resourceId),
      )
      .map((link) => link.id);
  }

  async deleteById({ id, projectId }: ShareLinkScope): Promise<void> {
    this.#remove((link) => link.id === id && link.projectId === projectId);
  }

  async deleteByResource({
    projectId,
    resourceType,
    resourceId,
  }: ShareResourceScope): Promise<void> {
    this.#remove(
      (link) =>
        link.projectId === projectId &&
        link.resourceType === resourceType &&
        link.resourceId === resourceId,
    );
  }

  async findAllTraceShareResourceIds(projectId: string): Promise<string[]> {
    const traces = this.#database.links
      .filter((link) => link.projectId === projectId && link.resourceType === "TRACE")
      .map((link) => link.resourceId);

    return [...new Set(traces)];
  }

  async deleteAllTraceShares(projectId: string): Promise<void> {
    this.#remove((link) => link.projectId === projectId && link.resourceType === "TRACE");
  }

  #matching({ projectId, resourceType, resourceId }: ShareResourceScope): ShareLink[] {
    return this.#database.links.filter(
      (link) =>
        link.projectId === projectId &&
        link.resourceType === resourceType &&
        link.resourceId === resourceId,
    );
  }

  #remove(matches: (link: ShareLink) => boolean): void {
    const kept = this.#database.links.filter((link) => !matches(link));

    this.#database.links.length = 0;
    this.#database.links.push(...kept);
  }
}
