/**
 * The manifest an author pastes into "Create app → From a manifest". One app serves the whole
 * workspace. `chat:write.public` posts to any public channel without an `/invite` first, and
 * `features.bot_user` must sit beside the bot scopes or Slack refuses the manifest.
 */
export const SLACK_APP_MANIFEST = `display_information:
  name: LangWatch
features:
  bot_user:
    display_name: LangWatch
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - chat:write.public
      - channels:read
      - groups:read`;
