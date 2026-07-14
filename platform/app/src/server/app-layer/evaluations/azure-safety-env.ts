export const AZURE_SAFETY_PROVIDER_KEY = "azure_safety";

export const AZURE_SAFETY_ENV_VARS = [
  "AZURE_CONTENT_SAFETY_ENDPOINT",
  "AZURE_CONTENT_SAFETY_KEY",
] as const;

export const AZURE_SAFETY_NOT_CONFIGURED_MESSAGE =
  "Azure Safety provider not configured. Configure it in Settings → Model Providers to run this evaluator.";

export function isAzureEvaluatorType(evaluatorType: string): boolean {
  return evaluatorType.startsWith("azure/");
}
