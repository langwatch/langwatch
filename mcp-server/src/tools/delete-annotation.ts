import { deleteAnnotation as apiDeleteAnnotation } from "../langwatch-api-annotations.js";

export async function handleDeleteAnnotation(params: { id: string }): Promise<string> {
  await apiDeleteAnnotation(params.id);

  return `Annotation deleted successfully!\n\n**ID**: ${params.id}`;
}
