// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HandledError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";

/**
 * The caller has no personal workspace yet, so there is no project for a
 * personal key to reach. The remedy is finishing workspace setup, which is
 * a sign-in away.
 */
export class IngestionKeyWorkspaceMissingError extends HandledError {
  declare readonly code: "ingestion_key_workspace_missing";

  constructor() {
    super(
      "ingestion_key_workspace_missing",
      "Sign in to a personal workspace before issuing an ingestion key.",
      {
        httpStatus: 412,
        ...remediation("ingestion_key_workspace_missing"),
      },
    );
    this.name = "IngestionKeyWorkspaceMissingError";
  }
}

/**
 * The personal mint was asked for a source type it does not mint here: a
 * tool the CLI wraps asked for from the tile or the MCP tool, which have no
 * session to parent a key to, or a source type no published template names.
 */
export class IngestionKeySourceNotAllowedError extends HandledError {
  declare readonly code: "ingestion_key_source_not_allowed";

  constructor(sourceType: string) {
    super(
      "ingestion_key_source_not_allowed",
      `No personal ingestion key is minted for source type ${sourceType} here.`,
      {
        httpStatus: 400,
        meta: { sourceType },
        ...remediation("ingestion_key_source_not_allowed"),
      },
    );
    this.name = "IngestionKeySourceNotAllowedError";
  }
}

/**
 * No ingestion key of the caller's has that id in this organization. Another
 * person's key reads the same way, so the answer never confirms one exists.
 */
export class IngestionKeyNotFoundError extends HandledError {
  declare readonly code: "ingestion_key_not_found";

  constructor(apiKeyId: string) {
    super("ingestion_key_not_found", "Ingestion key not found.", {
      httpStatus: 404,
      meta: { apiKeyId },
      ...remediation("ingestion_key_not_found"),
    });
    this.name = "IngestionKeyNotFoundError";
  }
}

/**
 * The CLI session asking for a key has a login key that is already revoked:
 * it was logged out, revoked from the devices tab, replaced by a re-login or
 * expired. Nothing minted under it would outlive the next cascade, so the
 * device signs in again instead.
 */
export class IngestionKeySessionRevokedError extends HandledError {
  declare readonly code: "ingestion_key_session_revoked";

  constructor() {
    super(
      "ingestion_key_session_revoked",
      "This device session is signed out. Sign in again to mint an ingestion key.",
      {
        httpStatus: 401,
        ...remediation("ingestion_key_session_revoked"),
      },
    );
    this.name = "IngestionKeySessionRevokedError";
  }
}

/**
 * A rotation that could not revoke every key it replaces, so it minted none.
 *
 * Rotation's whole promise is that no previous token survives it. Reporting
 * success while one is still live would hand the caller a fresh key and a
 * false statement about the old ones. Retrying is safe: the keys already
 * revoked stay revoked. `meta.survivors` names the machines still holding a
 * live key.
 */
export class IngestionKeyRevokeIncompleteError extends HandledError {
  declare readonly code: "ingestion_key_revoke_incomplete";

  constructor(survivors: readonly string[]) {
    super(
      "ingestion_key_revoke_incomplete",
      `Could not revoke ${survivors.length} of the previous ingestion keys, so no new key was minted.`,
      {
        httpStatus: 409,
        fault: "platform",
        meta: { survivors: [...survivors] },
        ...remediation("ingestion_key_revoke_incomplete"),
      },
    );
    this.name = "IngestionKeyRevokeIncompleteError";
  }
}
