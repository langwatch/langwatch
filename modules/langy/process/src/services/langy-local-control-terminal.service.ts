import type { AuthzApi } from "@langwatch/authz-contract";
import {
  approveControlRequestResponseSchema,
  langyControlCancelResultSchema,
  LangyLocalRequestInvalidError,
  listControlRequestsResponseSchema,
  type ApproveControlRequestResponse,
  type LangyControlOwnerInput,
  type LangyControlRequestCancelled,
  type LangyControlRequestInput,
  type ListControlRequestsResponse,
} from "@langwatch/langy-contract";

import { conversationUrl } from "../rules/langy-local-session-text.rules.ts";
import { ControlRequestAccessService } from "./langy-local-control-access.service.ts";
import { ControlRequestService } from "./langy-local-control-request.service.ts";

type TerminalRequests = Pick<
  ControlRequestService,
  "listOpen" | "getRequest" | "approve" | "cancel"
>;

/**
 * What the terminal's control requests answer (ADR-129), each operation one handler's branch
 * moved out of `transport/langy-local-control.rest.ts` unchanged.
 */
export class LangyLocalControlTerminalService {
  readonly #requests: TerminalRequests;
  readonly #access: ControlRequestAccessService;
  readonly #baseHost: string | undefined;

  private constructor(options: LangyLocalControlTerminalOptions) {
    this.#requests = options.requests;
    this.#access = ControlRequestAccessService.create({
      requests: options.requests,
      permissions: options.permissions,
    });
    this.#baseHost = options.baseHost;
  }

  static create(options: LangyLocalControlTerminalOptions): LangyLocalControlTerminalService {
    return new LangyLocalControlTerminalService(options);
  }

  async listRequests(input: LangyControlOwnerInput): Promise<ListControlRequestsResponse> {
    const requests = await this.#access.listReadable({ userId: controlUser(input) });
    return listControlRequestsResponseSchema.parse({
      requests: requests.map((r) => ControlRequestService.toWire(r)),
    });
  }

  async approveRequest(input: LangyControlRequestInput): Promise<ApproveControlRequestResponse> {
    const userId = controlUser(input);
    const addressed = await this.#access.getAddressed({
      requestId: input.requestId,
      userId,
      permission: "langy:create",
    });
    const approved = await this.#requests.approve({ requestId: addressed.id, userId });
    return approveControlRequestResponseSchema.parse({
      sessionKey: approved.sessionKey,
      endpoint: (this.#baseHost ?? "").replace(/\/+$/, ""),
      conversation: {
        id: approved.request.conversationId,
        title: approved.request.conversationTitle,
        url: conversationUrl(approved.request.conversationId, this.#baseHost, approved.projectSlug),
      },
    });
  }

  async cancelRequest(input: LangyControlRequestInput): Promise<LangyControlRequestCancelled> {
    const userId = controlUser(input);
    const addressed = await this.#access.getAddressed({
      requestId: input.requestId,
      userId,
      permission: "langy:create",
    });
    await this.#requests.cancel({ requestId: addressed.id, userId });
    return langyControlCancelResultSchema.parse({ id: input.requestId, cancelled: true });
  }
}

/**
 * The user the door put behind the caller's key. A key no person owns refuses the same way an
 * unknown request id does — the answer never reveals which requests exist.
 */
function controlUser(input: LangyControlOwnerInput): string {
  if (input.actor?.type !== "user") throw new LangyLocalRequestInvalidError();
  return input.actor.id;
}

export type LangyLocalControlTerminalOptions = Readonly<{
  /** The SAME request store the panel and the worker's door read. */
  requests: TerminalRequests;
  /** Decides a permission on the request's own project, not the login's. */
  permissions: Pick<AuthzApi, "getDecision">;
  baseHost: string | undefined;
}>;
