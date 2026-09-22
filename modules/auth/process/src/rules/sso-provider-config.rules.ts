/**
 * Opening the engine row's dialing document on the way out of storage (D09):
 * identity writes it sealed and this is the one seam that dials with it. Total
 * over both forms — a plaintext row written before the seal passes through.
 */
import { isSealedProviderConfig, type SsoProviderConfigCipher } from "@langwatch/identity-contract";
import type { DBAdapter } from "better-auth/types";

/** The engine's own name for the table identity projects. */
const SSO_PROVIDER_MODEL = "ssoProvider";

/** The engine's provider row, in the only two fields this opens. */
function holdsProviderConfig(
  row: unknown,
): row is { oidcConfig?: string | null; samlConfig?: string | null } {
  if (typeof row !== "object" || row === null) return false;
  return "oidcConfig" in row || "samlConfig" in row;
}

function openedConfig<Stored extends string | null | undefined>(
  stored: Stored,
  cipher: SsoProviderConfigCipher,
): Stored | string {
  if (typeof stored !== "string" || !isSealedProviderConfig(stored)) return stored;
  return cipher.open(stored);
}

function openedRow<Row>(row: Row, model: string, cipher: SsoProviderConfigCipher): Row {
  if (model !== SSO_PROVIDER_MODEL || !holdsProviderConfig(row)) return row;

  // Assigned in place: the row is the storage engine's own freshly decoded
  // object, and returning a copy would lose whatever else it carries.
  return Object.assign(row, {
    oidcConfig: openedConfig(row.oidcConfig, cipher),
    samlConfig: openedConfig(row.samlConfig, cipher),
  });
}

export function openingSsoProviderConfigs({
  adapter,
  cipher,
}: {
  adapter: DBAdapter;
  cipher: SsoProviderConfigCipher;
}): DBAdapter {
  return {
    ...adapter,
    async findOne<Row>(data: Parameters<DBAdapter["findOne"]>[0]): Promise<Row | null> {
      const row = await adapter.findOne<Row>(data);
      return row === null ? null : openedRow(row, data.model, cipher);
    },
    async findMany<Row>(data: Parameters<DBAdapter["findMany"]>[0]): Promise<Row[]> {
      const rows = await adapter.findMany<Row>(data);
      return rows.map((row) => openedRow(row, data.model, cipher));
    },
  };
}
