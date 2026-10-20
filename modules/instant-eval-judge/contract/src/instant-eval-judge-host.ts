/**
 * Whether LangWatch runs this install and so judges with its own classifier key: LangWatch Cloud,
 * or a development checkout of the repository. Any other install judges through Connect.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
export function isLangWatchJudgeHost({
  isSaas,
  nodeEnvironment,
}: {
  isSaas: boolean;
  nodeEnvironment: string | undefined;
}): boolean {
  return isSaas || nodeEnvironment === "development";
}
