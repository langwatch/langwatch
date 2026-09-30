import { generate } from "@langwatch/ksuid";
import { SLACK_INTEGRATION_KSUID_RESOURCE } from "@langwatch/slack-contract";
import { nowInstant } from "@langwatch/time";

import {
  SlackConnectionRepository,
  type SlackConnectionChanges,
  type SlackConnectionRecord,
  type SlackConnectionRow,
  type SlackScope,
} from "../slack-connection.repository.ts";

/** The unique index `(organizationId, scopeType, scopeId, secretFingerprint)`. */
const uniqueKey = (row: SlackConnectionRecord): string =>
  [row.organizationId, row.scopeType, row.scopeId, row.secretFingerprint].join("\u0000");

/** The memory tier: the Postgres regime, the unique index included, over a map. */
export class MemorySlackConnectionRepository extends SlackConnectionRepository {
  readonly #rows = new Map<string, SlackConnectionRow>();

  static create(): MemorySlackConnectionRepository {
    return new MemorySlackConnectionRepository();
  }

  findById({ id }: { id: string }): Promise<SlackConnectionRow[]> {
    const row = this.#rows.get(id);
    return Promise.resolve(row ? [{ ...row }] : []);
  }

  findAllUsableByProject({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }): Promise<SlackConnectionRow[]> {
    const rows = [...this.#rows.values()]
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          ((row.scopeType === "ORGANIZATION" && row.scopeId === organizationId) ||
            (row.scopeType === "PROJECT" && row.scopeId === projectId)),
      )
      .toSorted(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          a.createdAt.epochMilliseconds - b.createdAt.epochMilliseconds,
      );
    return Promise.resolve(rows.map((row) => ({ ...row })));
  }

  findAllByFingerprint({
    organizationId,
    secretFingerprint,
    scopes,
  }: {
    organizationId: string;
    secretFingerprint: string;
    scopes: SlackScope[];
  }): Promise<SlackConnectionRow[]> {
    const rows = [...this.#rows.values()]
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          row.secretFingerprint === secretFingerprint &&
          scopes.some(
            (scope) => scope.scopeType === row.scopeType && scope.scopeId === row.scopeId,
          ),
      )
      .toSorted((a, b) => a.createdAt.epochMilliseconds - b.createdAt.epochMilliseconds);
    return Promise.resolve(rows.map((row) => ({ ...row })));
  }

  create({
    record,
  }: {
    record: SlackConnectionRecord;
    actorId: string;
  }): Promise<SlackConnectionRow[]> {
    if (this.#collides({ candidate: record })) return Promise.resolve([]);
    const now = nowInstant();
    const row = {
      ...record,
      id: generate(SLACK_INTEGRATION_KSUID_RESOURCE).toString(),
      createdAt: now,
      updatedAt: now,
    };
    this.#rows.set(row.id, row);
    return Promise.resolve([{ ...row }]);
  }

  update({
    id,
    organizationId,
    changes,
  }: {
    id: string;
    organizationId: string;
    changes: SlackConnectionChanges;
    actorId: string;
  }): Promise<SlackConnectionRow[]> {
    const current = this.#rows.get(id);
    if (!current || current.organizationId !== organizationId) {
      return Promise.reject(
        new Error(`No SlackIntegration ${id} in organization ${organizationId}`),
      );
    }
    const next = { ...current, ...changes, updatedAt: nowInstant() };
    if (this.#collides({ candidate: next, exceptId: id })) return Promise.resolve([]);
    this.#rows.set(id, next);
    return Promise.resolve([{ ...next }]);
  }

  delete({ id, organizationId }: { id: string; organizationId: string }): Promise<void> {
    if (this.#rows.get(id)?.organizationId === organizationId) this.#rows.delete(id);
    return Promise.resolve();
  }

  #collides({
    candidate,
    exceptId,
  }: {
    candidate: SlackConnectionRecord;
    exceptId?: string;
  }): boolean {
    const key = uniqueKey(candidate);
    return [...this.#rows.values()].some((row) => row.id !== exceptId && uniqueKey(row) === key);
  }
}
