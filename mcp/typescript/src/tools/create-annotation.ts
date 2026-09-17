import { createAnnotation as apiCreateAnnotation } from "../langwatch-api-annotations.js";

export async function handleCreateAnnotation(params: {
  traceId: string;
  comment?: string;
  isThumbsUp?: boolean;
  email?: string;
}): Promise<string> {
  const annotation = await apiCreateAnnotation(params.traceId, {
    comment: params.comment,
    isThumbsUp: params.isThumbsUp,
    email: params.email,
  });

  let rating = "";
  if (params.isThumbsUp === true) {
    rating = " 👍";
  } else if (params.isThumbsUp === false) {
    rating = " 👎";
  }

  return `Annotation created successfully!${rating}\n\n**ID**: ${annotation.id ?? "—"}\n**Trace ID**: ${params.traceId}${params.comment ? `\n**Comment**: ${params.comment}` : ""}`;
}
