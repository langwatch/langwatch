/**
 * The stored filter sets the explorer offers, composed as their own feature.
 * `savedViews.*` — one namespace over one Postgres adapter.
 */
import { PostgresSavedViewAdapter, type SavedViewTrpcPorts } from "@langwatch/dashboard-server";
import { HandledError } from "@langwatch/handled-error";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure";
import { createSavedViewTrpcRouter } from "./dashboard-trpc.mount";

import type { ComposedSavedViewFeature } from "./saved-view.composition.types";

/** Composes the stored filter sets over this process's own graph. */
export function composeSavedViewFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
}): ComposedSavedViewFeature {
  const ports = {
    savedViews: PostgresSavedViewAdapter.create({
      database: options.infrastructure.prisma,
    }).build(),
  };

  return { router: (mount) => createSavedViewTrpcRouter({ ...mount, ports }) };
}

/**
 * The stored filter sets on a process that composed no database. The namespace still
 * mounts and every call refuses by name, so the explorer says the deployment cannot
 * answer rather than showing a person an empty list of views they know they saved.
 */
export function refusingSavedViewFeature(): ComposedSavedViewFeature {
  const refuse = (): never => {
    throw new ApiSavedViewUnavailableError("Saved views");
  };
  const ports = {
    savedViews: new Proxy({}, { get: () => refuse, has: () => true }),
  } as SavedViewTrpcPorts<unknown>;

  return { router: (mount) => createSavedViewTrpcRouter({ ...mount, ports }) };
}

/** A capability this deployment did not compose, refused by name. */
class ApiSavedViewUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} are not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiSavedViewUnavailableError";
  }
}
