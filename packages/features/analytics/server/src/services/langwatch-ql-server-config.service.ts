/**
 * LangWatchQL analytics SQL — the two server-level prerequisites that are not expressible in
 * SQL and ship as ClickHouse XML.
 * @see ./langwatch-ql-access-model.service.ts — the model these make possible
 */
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service";

const sqlText = LangWatchQLSqlTextService.create();

/**
 * Server-level ClickHouse config declaring the `custom_` settings prefix.
 */
export const CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML = `<clickhouse>
    <custom_settings_prefixes>custom_</custom_settings_prefixes>
</clickhouse>
`;

/** Where {@link CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML} must be installed. */
export const CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH =
  "/etc/clickhouse-server/config.d/custom-settings-prefix.xml";

/**
 * Where {@link clickHouseAccessManagementConfigXml} must be installed. The `zz-` prefix is
 * load-bearing, not decoration.
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
   * Server-level ClickHouse config granting the *administrative* user the right to create
   * users, profiles, row policies and named collections through SQL.
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
