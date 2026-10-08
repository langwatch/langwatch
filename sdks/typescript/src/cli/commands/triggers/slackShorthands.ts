/**
 * The Slack fields the trigger commands take as flags, merged over
 * `--action-params`. `--slack-connection` names a Slack connection; a bot
 * connection also needs `--slack-channel`.
 */
export function slackShorthands({
  slackConnection,
  slackChannel,
  slackWebhook,
}: {
  slackConnection?: string;
  slackChannel?: string;
  slackWebhook?: string;
}): Record<string, string> {
  return {
    ...(slackConnection ? { slackIntegrationId: slackConnection } : {}),
    ...(slackChannel ? { slackChannelId: slackChannel } : {}),
    ...(slackWebhook ? { slackWebhook } : {}),
  };
}
