import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { LangyLocalRequestInvalidError } from "@langwatch/langy-contract";

import type {
  ControlRequestService,
  StoredControlRequest,
} from "./langy-local-control-request.service.ts";

/** The two permissions a control request is read and acted on under. */
export type ControlRequestPermission = "langy:view" | "langy:create";

/**
 * Which of a person's control requests they may still reach. The project is the request's own,
 * never the login's: a device login answers as the personal project while the conversation that
 * asked lives on a team project. Spec: specs/langy/langy-local-control.feature
 */
export class ControlRequestAccessService {
  static create(deps: {
    requests: Pick<ControlRequestService, "listOpen" | "getRequest">;
    permissions: Pick<AuthzApi, "getDecision">;
  }): ControlRequestAccessService {
    return new ControlRequestAccessService(deps.requests, deps.permissions);
  }

  private constructor(
    private readonly requests: Pick<ControlRequestService, "listOpen" | "getRequest">,
    private readonly permissions: Pick<AuthzApi, "getDecision">,
  ) {}

  /** The person's open requests on every project they can still read. */
  async listReadable({ userId }: { userId: string }): Promise<StoredControlRequest[]> {
    const requests = await this.requests.listOpen({ userId });
    const decisions = new Map<string, boolean>();
    const readable: StoredControlRequest[] = [];
    for (const request of requests) {
      let permitted = decisions.get(request.projectId);
      if (permitted === undefined) {
        permitted = await this.permittedOn({
          userId,
          projectId: request.projectId,
          permission: "langy:view",
        });
        decisions.set(request.projectId, permitted);
      }
      if (permitted) {
        readable.push(request);
      }
    }

    return readable;
  }

  /**
   * The request the caller is about to act on, when it is addressed to them and they hold
   * `permission` on its own project. Anything else answers exactly like an unknown id.
   */
  async getAddressed({
    requestId,
    userId,
    permission,
  }: {
    requestId: string;
    userId: string;
    permission: ControlRequestPermission;
  }): Promise<StoredControlRequest> {
    const request = await this.requests.getRequest(requestId).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "langy_local_record_not_found") {
        throw new LangyLocalRequestInvalidError({ requestId });
      }
      throw error;
    });
    if (request.userId !== userId) {
      throw new LangyLocalRequestInvalidError({ requestId });
    }
    const permitted = await this.permittedOn({
      userId,
      projectId: request.projectId,
      permission,
    });
    if (!permitted) {
      throw new LangyLocalRequestInvalidError({ requestId });
    }

    return request;
  }

  private async permittedOn({
    userId,
    projectId,
    permission,
  }: {
    userId: string;
    projectId: string;
    permission: ControlRequestPermission;
  }): Promise<boolean> {
    const { permitted } = await this.permissions.getDecision({
      userId,
      permission,
      scope: { tier: "project", id: projectId },
    });

    return permitted;
  }
}
