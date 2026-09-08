/** Binds the annotation REST declaration to this process's credential boundary. */
import { AnnotationNotFoundError, type AnnotationApi } from "@langwatch/annotation-contract";
import { annotationRest } from "@langwatch/annotation-server";
import {
  createRestRuntime,
  type MountableRestApp,
  type RequestValidationError,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features.ts";

class AnnotationRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("annotation request refused");
    this.name = "AnnotationRefusal";
  }
}

/** Mounts `/api/annotations` with its historical refusal bodies. */
export function mountAnnotationRest(options: {
  annotations: () => AnnotationApi;
  credential: ApiHandlerManagedCredentialPort;
}): MountableRestApp {
  const runtime = createRestRuntime({
    identity: {
      authenticate: async ({ request, permission }) => {
        const credential = await options.credential({ request, permission });
        if (!credential.ok) throw new AnnotationRefusal(credential.status, credential.body);

        return {
          actor: null,
          scope: { tier: "project", id: credential.project.id },
          markUsed: credential.markUsed,
        };
      },
    },
  });

  return runtime.mount(annotationRest.router(), {
    app: options.annotations,
    credential: "projectKey",
    onError: annotationErrorHandler,
  });
}

/** Every refusal these routes raise, in the bodies this family has always answered. */
const annotationErrorHandler: RestErrorHandler = (error, context) => {
  if (error instanceof AnnotationRefusal) return context.json(error.body, error.status);

  if (error instanceof AnnotationNotFoundError) {
    return context.json({ status: "error", message: "Annotation not found." }, 404);
  }

  if (isRequestValidationError(error)) return validationFailure(context, error);

  return context.json({ status: "error", message: "Internal server error." }, 500);
};

function isRequestValidationError(error: unknown): error is RequestValidationError {
  return error instanceof Error && error.name === "RequestValidationError";
}

function validationFailure(context: Context, error: RequestValidationError): Response {
  const fields = (error.meta.fields as string[] | undefined) ?? [];

  if (offends(fields, "comment")) {
    return context.json(
      {
        status: "error",
        message: "[comment] is required in the request body and must be a string.",
      },
      400,
    );
  }

  if (offends(fields, "isThumbsUp")) {
    return context.json(
      {
        status: "error",
        message: "[isThumbsUp] is required in the request body and must be a boolean.",
      },
      400,
    );
  }

  return context.json({ status: "error", message: "Invalid request body." }, 400);
}

function offends(fields: readonly string[], name: string): boolean {
  return fields.some((field) => field === name || field.startsWith(`${name}.`));
}
