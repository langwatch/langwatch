import type { RestIdentity } from "@langwatch/api/hosting";
/**
 * One conversation, its Langy keys and a small evaluator family mounted on the real REST runtime,
 * with the confirmation gate wired the way the Langy module wires it. The store behind the cards
 * and the clicks is the caller's, so the same walk runs over memory twins and over Redis.
 */
import {
  canonicalErrorResponse,
  createRestRuntime,
  defineRestRouter,
  recordProjectCredential,
} from "@langwatch/api/rest";
import type { RestResolvedProjectCredential } from "@langwatch/authorization";
import { LANGY_CHOICE_SELECTION_PART_TYPE } from "@langwatch/langy-contract";
import { moduleApi } from "@langwatch/module";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { z } from "zod";

import type { LangyDeleteConfirmationRepository } from "../../../../repositories/langy-delete-confirmation.repository.ts";
import { LangyLocalControlRequestMemoryRepository } from "../../../../repositories/memory/memory.langy-local-control-request.repository.ts";
import { LangyLocalUserWaitRedisRepository } from "../../../../repositories/redis/redis.langy-local-user-wait.repository.ts";
import type { ConfirmTarget } from "../../../../rules/langy-local-control-keys.rules.ts";
import type {
  UserWaitBuffer,
  UserWaitEvents,
} from "../../../../rules/langy-local-user-wait-record.rules.ts";
import { UserWaitService } from "../../../local-control/services/langy-local-user-wait.service.ts";
import { LangyConfirmationAnswersService } from "../langy-confirmation-answers.service.ts";
import { LangyDeleteConfirmationService } from "../langy-delete-confirmation.service.ts";

interface EvaluatorsApi {
  archive(id: string): Promise<void>;
  archiveRows(ids: readonly string[]): Promise<void>;
  disable(id: string): Promise<void>;
  /** Undefined when there is no such evaluator. */
  nameOf(id: string): Promise<string | undefined>;
}

const EvaluatorsApi = moduleApi<EvaluatorsApi>()("evaluator");

const VERSION = "2026-10-05";
const USER_ID = "user_owner";

/** What a started card carries, as the durable event names it. */
type StartedCard = {
  turnId: string;
  waitId: string;
  toolCallId?: string;
  questions?: { question: string; options: { label: string }[]; allowOther?: boolean }[];
};

export function deleteConfirmationFixture({
  store,
  confirmations,
  projectId,
  now,
}: {
  store: SessionStateStore;
  confirmations: LangyDeleteConfirmationRepository;
  projectId: string;
  now: () => number;
}) {
  const conversationId = `conv_${projectId}`;
  const started: StartedCard[] = [];
  const ended: { waitId: string; outcome: string }[] = [];
  const events: UserWaitEvents = {
    startUserWait: async (data) => void started.push(data as StartedCard),
    endUserWait: async (data) => void ended.push(data),
  };
  const buffer: UserWaitBuffer = {
    appendLocalPermission: async () => undefined,
    appendQuestion: async () => undefined,
    appendStatus: async () => undefined,
    heartbeat: async () => undefined,
  };

  const answers = LangyConfirmationAnswersService.create({ confirmations });
  const waits = UserWaitService.create({
    waits: LangyLocalUserWaitRedisRepository.create({ store }),
    events,
    buffer,
    onAnswered: (wait) => answers.recordAnswer(wait),
    now,
  });
  const turn = { current: "turn_1" as string | null };
  const gate = LangyDeleteConfirmationService.create({
    confirmations,
    answers,
    waits,
    localKeys: LangyLocalControlRequestMemoryRepository.create({ now }),
    conversations: {
      findByIdVisible: async () => ({ isOwn: true, currentTurnId: turn.current }),
    },
  });

  const names = new Map([
    ["ev_toxicity", "Toxicity check"],
    ["ev_faithful", "Faithfulness"],
    ["ev_sprawling_a1b2", `scratch\ncopy\u0007 ${"x".repeat(120)}`],
  ]);
  const archived: string[] = [];
  const disabled: string[] = [];
  const app: EvaluatorsApi = {
    archive: async (id) => void archived.push(id),
    archiveRows: async (ids) => void archived.push(...ids),
    disable: async (id) => void disabled.push(id),
    nameOf: async (id) => names.get(id),
  };

  const router = defineRestRouter(EvaluatorsApi)
    .withNamespace("evaluators")
    .withVersion(VERSION)
    .delete("/:id", "archive")
    .withAudit("evaluators.delete")
    .withParams(z.object({ id: z.string() }))
    .withPermission("evaluations:manage")
    .withConfirmation({
      resource: "evaluator",
      action: "delete",
      idParam: "id",
      name: ({ app: evaluators, id }) => evaluators.nameOf(id),
    })
    .withOutput(z.object({ archived: z.string() }))
    .handle(async ({ app: evaluators, input }) => {
      await evaluators.archive(input.id);
      return { archived: input.id };
    })
    .post("/:id/disable", "disable")
    .withAudit("evaluators.disable")
    .withParams(z.object({ id: z.string() }))
    .withPermission("evaluations:update")
    .withConfirmation({
      resource: "evaluator",
      action: "disable",
      idParam: "id",
      name: ({ app: evaluators, id }) => evaluators.nameOf(id),
    })
    .withOutput(z.object({ disabled: z.string() }))
    .handle(async ({ app: evaluators, input }) => {
      await evaluators.disable(input.id);
      return { disabled: input.id };
    })
    .post("/rows/delete", "archiveRows")
    .withAudit("evaluators.rows.delete")
    .withInput(z.object({ ids: z.array(z.string()) }))
    .withPermission("evaluations:manage")
    .withConfirmation({
      resource: "evaluator",
      action: "delete",
      idsField: "ids",
      name: ({ app: evaluators, id }) => evaluators.nameOf(id),
    })
    .withOutput(z.object({ archived: z.number() }))
    .handle(async ({ app: evaluators, input }) => {
      await evaluators.archiveRows(input.ids);
      return { archived: input.ids.length };
    })
    .build()
    .router();

  const project = { id: projectId, slug: "p", teamId: "team_1" } as never;
  const credential = (apiKeyId: string, langy: boolean): RestResolvedProjectCredential => ({
    type: "apiKey",
    apiKeyId,
    userId: USER_ID,
    organizationId: "org_1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    ...(langy ? { isLangySessionKey: true } : {}),
    project,
  });
  const keys: Record<string, RestResolvedProjectCredential> = {
    turn1: credential(`key_turn1_${projectId}`, true),
    turn2: credential(`key_turn2_${projectId}`, true),
    unbound: credential(`key_unbound_${projectId}`, true),
    personal: credential(`key_personal_${projectId}`, false),
  };
  const door: RestIdentity = {
    authenticate: ({ request }) => {
      const resolved = keys[request.headers.get("x-auth-token") ?? ""];
      if (!resolved) throw new Error("unknown test key");
      recordProjectCredential(request, resolved);
      return {
        actor: { type: "api_key", id: resolved.type === "apiKey" ? resolved.apiKeyId : "" },
        scope: { tier: "project", id: projectId },
      };
    },
  };
  const authz = restTestAuthorization().forRequest();
  const rest = createRestRuntime({
    authorization: { forRequest: () => authz },
    identity: door,
    audit: { record: async () => undefined },
    confirmations: gate,
    // The envelope every REST family answers with, so the refusal reads as Langy reads it.
  }).mount(router, { app: () => app, onError: canonicalErrorResponse });

  async function call({
    key,
    method,
    path,
    body,
  }: {
    key: keyof typeof keys;
    method: string;
    path: string;
    body?: unknown;
  }) {
    const response = await rest.request(`/api/evaluators/${VERSION}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-auth-token": key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: (await response.json()) as { code?: string; message?: string },
    };
  }

  function target(id: string, action = "delete"): ConfirmTarget {
    return { projectId, conversationId, resource: "evaluator", action, id };
  }

  /** The card waiting for one record, as the panel finds it. */
  async function cardFor(id: string, action = "delete"): Promise<StoredCardHandle> {
    const card = await confirmations.lookupPendingCard(target(id, action));
    if (card.kind !== "hit") throw new Error(`no card for ${action} ${id}`);
    const wait = await waits.getWait(card.value);
    return { waitId: card.value, question: wait.confirm?.question ?? "" };
  }

  return {
    projectId,
    conversationId,
    turn,
    started,
    ended,
    archived,
    disabled,
    waits,
    gate,
    cardFor,
    /** Binds a minted turn key to the conversation, as the key mint does. */
    bindKey: (key: "turn1" | "turn2", turnId?: string) => {
      const resolved = keys[key]!;
      return confirmations.saveKeyBinding({
        apiKeyId: resolved.type === "apiKey" ? resolved.apiKeyId : "",
        binding: { projectId, conversationId, ...(turnId ? { turnId } : {}) },
        ttlSeconds: 6 * 60 * 60,
      });
    },
    deleteEvaluator: (id: string, key: keyof typeof keys = "turn1") =>
      call({ key, method: "DELETE", path: `/${id}` }),
    disableEvaluator: (id: string, key: keyof typeof keys = "turn1") =>
      call({ key, method: "POST", path: `/${id}/disable` }),
    deleteMany: (ids: string[], key: keyof typeof keys = "turn1") =>
      call({ key, method: "POST", path: "/rows/delete", body: { ids } }),
    /** A click on the card's own button, as the panel answers it. */
    click: async ({ id, choice, action = "delete" }: ClickInput) => {
      const card = await cardFor(id, action);
      await waits.answer({
        waitId: card.waitId,
        userId: USER_ID,
        answers: [
          {
            question: card.question,
            selected: [choice === "yes" ? `Yes, ${action}` : "No, keep it"],
          },
        ],
      });
    },
    /** A message the person sent, with a structured click when the panel attached one. */
    sendMessage: ({
      text,
      selection,
    }: {
      text: string;
      selection?: { waitId: string; optionId: string };
    }) =>
      gate.acceptSelection({
        projectId,
        conversationId,
        userId: USER_ID,
        parts: [
          ...(selection
            ? [
                {
                  type: LANGY_CHOICE_SELECTION_PART_TYPE,
                  blockId: `question:${selection.waitId}:0`,
                  optionIds: [selection.optionId],
                },
              ]
            : []),
          { type: "text", text },
        ],
      }),
  };
}

type StoredCardHandle = { waitId: string; question: string };
type ClickInput = { id: string; choice: "yes" | "no"; action?: string };
