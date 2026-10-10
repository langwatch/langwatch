/**
 * Slack app manifest an author pastes into "Create app → From a manifest" to
 * skip manual scope setup. One app serves the whole workspace (not per
 * automation), so the name is generic. It grants:
 *   - `chat:write` — post messages to channels the bot is a member of
 *   - `chat:write.public` — post to ANY public channel without being invited
 *     first; without it Slack rejects the post with `not_in_channel` until the
 *     bot is manually `/invite`d, which is the #1 setup snag
 *   - `channels:read` / `groups:read` — populate the channel picker
 * `features.bot_user` is required alongside `oauth_config.scopes.bot` —
 * Slack rejects the manifest with "OAuth requires bot_user" without it.
 *
 * Its own module rather than the composer's, because since ADR-093 §5 the
 * settings card is where the token is pasted: importing this from `client.tsx`
 * would drag the Monaco editors and the template gallery into the settings
 * bundle for the sake of one string.
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
