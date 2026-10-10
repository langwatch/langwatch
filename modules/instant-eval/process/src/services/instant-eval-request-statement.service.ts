/**
 * The statement a run request means: the caller's own SQL, or a shorthand with its filter
 * compiled against the trace view or resolved into a selection by the explorer's compiler.
 * @see modules/instant-eval/specs/instant-eval-api.feature
 */

import type { Actor, Authorization } from "@langwatch/authorization";
import { PermissionDeniedError } from "@langwatch/authorization";
import {
  type InstantEvalActor,
  InstantEvalQueryInvalidError,
  type InstantEvalRunInput,
} from "@langwatch/instant-eval-contract";
import type { Instant } from "@langwatch/time";
import type { LangWatchQLTraceFilter } from "@langwatch/trace-contract";

import {
  compileInstantEvalFilter,
  instantEvalStatementFor,
  refuseUnsupportedShorthandFilter,
  type InstantEvalStatement,
} from "../rules/instant-eval-run-input.rules.ts";
import { instantEvalShorthandWindow } from "../rules/instant-eval-shorthand.rules.ts";
import type { InstantEvalTraceProofService } from "./instant-eval-trace-proof.service.ts";

/** The peers a request's statement is built through. */
export interface InstantEvalRequestStatementPeers {
  /** The database the LangWatchQL views live in. */
  database(): string;
  /**
   * A target's filter compiled against the LangWatchQL trace view, so the
   * statement carries it and can be rerun. Absent where none is wired, and the
   * filter is then resolved into a selection.
   */
  compileFilter?(input: { filter: string }): LangWatchQLTraceFilter;
  /**
   * The trace ids a target's filter selects through the explorer's compiler,
   * capped at the row limit: what a field outside the trace row is judged by.
   * Absent where none is wired, and such a filter is refused, never ignored.
   */
  selectTraceIds?(input: {
    projectId: string;
    authorization: Authorization;
    filter: string;
    window: { from: number; to: number };
    limit: number;
  }): Promise<readonly string[]>;
}

export class InstantEvalRequestStatementService {
  private constructor(
    private readonly peers: InstantEvalRequestStatementPeers,
    private readonly proofs: Pick<InstantEvalTraceProofService, "mint">,
    private readonly now: () => Instant,
  ) {}

  static create({
    peers,
    proofs,
    now,
  }: {
    peers: InstantEvalRequestStatementPeers;
    proofs: Pick<InstantEvalTraceProofService, "mint">;
    now: () => Instant;
  }): InstantEvalRequestStatementService {
    return new InstantEvalRequestStatementService(peers, proofs, now);
  }

  async statementFor({
    projectId,
    actor,
    input,
    rowLimit,
  }: {
    projectId: string;
    actor: InstantEvalActor;
    input: InstantEvalRunInput;
    rowLimit: number;
  }): Promise<InstantEvalStatement> {
    const base = { input, database: this.peers.database(), now: this.now() };
    const filter = this.#shorthandFilterOf(input);
    if (filter === undefined) return instantEvalStatementFor(base);
    const peers = this.peers;
    if (!peers.compileFilter) {
      return instantEvalStatementFor({
        ...base,
        selection: await this.#selectionFor({ projectId, actor, input, filter, rowLimit }),
      });
    }

    const compiled = compileInstantEvalFilter({
      compile: (input) => peers.compileFilter?.(input) ?? { kind: "empty" },
      filter,
    });
    switch (compiled.kind) {
      case "empty":
        return instantEvalStatementFor(base);
      case "compiled":
        return instantEvalStatementFor({
          ...base,
          filter: { sql: compiled.sql, parameters: compiled.parameters },
        });
      case "refused":
        throw new InstantEvalQueryInvalidError({ reason: compiled.reason, fields: ["filter"] });
      case "unsupported":
        // The explorer's own compiler answers what the trace view cannot.
        if (!this.peers.selectTraceIds) {
          refuseUnsupportedShorthandFilter(compiled);
        }
        return instantEvalStatementFor({
          ...base,
          selection: await this.#selectionFor({ projectId, actor, input, filter, rowLimit }),
        });
    }
  }

  /** The shorthand's filter, when the request is a shorthand that names one. */
  #shorthandFilterOf(input: InstantEvalRunInput): string | undefined {
    if (typeof input.sql === "string" && input.sql.trim() !== "") return undefined;
    const filter = input.shorthand?.filter?.trim();
    return filter === undefined || filter === "" ? undefined : filter;
  }

  /** The trace ids a target's filter selects, resolved by the explorer's own compiler. */
  async #selectionFor({
    projectId,
    actor,
    input,
    filter,
    rowLimit,
  }: {
    projectId: string;
    actor: InstantEvalActor;
    input: InstantEvalRunInput;
    filter: string;
    rowLimit: number;
  }): Promise<readonly string[]> {
    const shorthand = input.shorthand;
    if (!this.peers.selectTraceIds || shorthand === undefined) {
      throw new InstantEvalQueryInvalidError({
        reason:
          "This deployment cannot resolve a target's filter, so the rows it names cannot be judged. " +
          "Send a statement with the selection written into its WHERE clause instead.",
        fields: ["filter"],
      });
    }
    const window = instantEvalShorthandWindow({ shorthand, now: this.now() });

    const authorization = await this.proofs.mint({
      projectId,
      actor: proofActorOf({ projectId, actor }),
      route: "instantEval.runs",
    });

    return this.peers.selectTraceIds({
      projectId,
      authorization,
      filter,
      window: { from: window.start.epochMilliseconds, to: window.end.epochMilliseconds },
      limit: rowLimit,
    });
  }
}

/** Who a selection's proof is minted for: the member, or the door's actor (ruling IE-KEY-ACTOR). */
function proofActorOf({ projectId, actor }: { projectId: string; actor: InstantEvalActor }): Actor {
  if (actor.kind === "member") return { type: "user", id: actor.userId };
  if (actor.actor) return actor.actor;
  throw new PermissionDeniedError({
    permission: "traces:view",
    scope: { type: "project", id: projectId },
    denialReason: "no-grant",
  });
}
