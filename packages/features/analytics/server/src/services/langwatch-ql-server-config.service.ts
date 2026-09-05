/**
 * LangWatchQL analytics SQL — the two server-level prerequisites that are not
 * expressible in SQL and ship as ClickHouse XML.
 *
 * Without the settings prefix, every statement in the access model fails with
 * `UNKNOWN_SETTING` (115) and no part of the model can be created.
 *
 * @see ./langwatch-ql-access-model.service.ts — the model these make possible
 */
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service";

const sqlText = LangWatchQLSqlTextService.create();

/**
 * Server-level ClickHouse config declaring the `custom_` settings prefix.
 *
 * A deployment prerequisite, not an optimisation: without it ClickHouse rejects
 * the settings profile below with
 * `Setting custom_api_key_hash is neither a builtin setting nor started with
 * the prefix 'SQL_'` (UNKNOWN_SETTING, 115), and no part of the model can be
 * created. Belongs at {@link CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH}.
 */
export const CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML = `<clickhouse>
    <custom_settings_prefixes>custom_</custom_settings_prefixes>
</clickhouse>
`;

/** Where {@link CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML} must be installed. */
export const CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH =
  "/etc/clickhouse-server/config.d/custom-settings-prefix.xml";

/**
 * Where {@link clickHouseAccessManagementConfigXml} must be installed.
 *
 * The `zz-` prefix is load-bearing, not decoration. ClickHouse merges
 * `users.d/*.xml` in lexicographic order and the later file wins, while the
 * official image's entrypoint writes `users.d/default-user.xml` declaring
 * `<access_management>0</access_management>` for that same user. A file named
 * `access-management.xml` sorts *before* it and is silently overridden, leaving
 * the administrative user unable to create any of the objects below.
 */
export const CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH =
  "/etc/clickhouse-server/users.d/zz-lwql-access-management.xml";

/** The ClickHouse server configuration the LangWatchQL access model requires. */
export class LangWatchQLServerConfigService {
  static create(): LangWatchQLServerConfigService {
    return new LangWatchQLServerConfigService();
  }

  private constructor() {}

  /**
   * Server-level ClickHouse config granting the *administrative* user the right
   * to create users, profiles, row policies and named collections through SQL.
   *
   * Parameterized by user name rather than hardcoded to `default`, because the
   * administrative account is not always `default`: the official image's
   * entrypoint replaces `default` with whatever `CLICKHOUSE_USER` names, so a
   * config addressing `default` silently applies to nobody.
   *
   * Nothing here widens what the restricted identity can do — it must never
   * carry these. Belongs at {@link CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH}.
   */
  accessManagementConfigXml({ administrativeUser }: { administrativeUser: string }): string {
    sqlText.assertIdentifier(administrativeUser, "administrativeUser");

    return `<clickhouse>
      <users>
          <${administrativeUser}>
              <access_management>1</access_management>
              <named_collection_control>1</named_collection_control>
              <show_named_collections>1</show_named_collections>
              <show_named_collections_secrets>1</show_named_collections_secrets>
          </${administrativeUser}>
      </users>
  </clickhouse>
  `;
  }
}
