import type { SlackConnection, SlackFieldRefusal } from "@langwatch/slack-browser-kit";
import type { SlackConnectionKind, SlackConnectionScopeType } from "@langwatch/slack-contract";
import { useState } from "react";

export interface ConnectionScope {
  scopeType: SlackConnectionScopeType;
  scopeId: string;
}

export interface SlackConnectionDraft {
  kind: SlackConnectionKind;
  name: string;
  scope: ConnectionScope;
  secret: string | undefined;
}

/**
 * The form's field state; `submit` hands back a draft, or marks the missing fields and returns
 * none.
 */
export function useSlackConnectionFormState({
  connection,
  projectId,
  organizationId,
  canManageProject,
  canManageOrganization,
}: {
  connection: SlackConnection | undefined;
  projectId: string | undefined;
  organizationId: string | undefined;
  canManageProject: boolean;
  canManageOrganization: boolean;
}) {
  const [kind, setKind] = useState<SlackConnectionKind>(connection?.kind ?? "BOT");
  const [name, setName] = useState(connection?.name ?? "");
  const [scopes, setScopes] = useState<ConnectionScope[]>(() =>
    initialScopes({
      connection,
      projectId: canManageProject ? projectId : void 0,
      organizationId: canManageOrganization ? organizationId : void 0,
    }),
  );
  const [secret, setSecret] = useState("");
  const [isReplacingSecret, setIsReplacingSecret] = useState(!connection);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const scope = scopes[0];
  const missing = missingFields({ name, scope, secret, isReplacingSecret });
  const errors = hasAttemptedSubmit ? missing : NO_ERRORS;

  const submit = (): SlackConnectionDraft[] => {
    setHasAttemptedSubmit(true);
    if (!scope || missing.name || missing.secret) return [];
    return [{ kind, name: name.trim(), scope, secret: isReplacingSecret ? secret.trim() : void 0 }];
  };

  const changeReplacing = (replacing: boolean) => {
    setIsReplacingSecret(replacing);
    setSecret("");
  };

  return {
    kind,
    setKind,
    name,
    setName,
    scopes,
    setScopes,
    secret,
    setSecret,
    isReplacingSecret,
    changeReplacing,
    errors,
    errorTexts: (refusal: SlackFieldRefusal) =>
      fieldErrorTexts({ missing: errors, refusal, isBot: kind === "BOT" }),
    submit,
  };
}

const NO_ERRORS = { name: false, scope: false, secret: false };

/** Missing-field copy first; otherwise the field a refused save named. */
function fieldErrorTexts({
  missing,
  refusal,
  isBot,
}: {
  missing: { scope: boolean; secret: boolean };
  refusal: SlackFieldRefusal;
  isBot: boolean;
}): SlackFieldRefusal {
  const missingSecret = isBot ? "Paste the bot token." : "Paste the webhook URL.";
  return {
    scope: missing.scope ? "Choose who can use the connection." : refusal.scope,
    secret: missing.secret ? missingSecret : refusal.secret,
  };
}

function missingFields({
  name,
  scope,
  secret,
  isReplacingSecret,
}: {
  name: string;
  scope: ConnectionScope | undefined;
  secret: string;
  isReplacingSecret: boolean;
}) {
  return {
    name: name.trim().length === 0,
    scope: !scope,
    secret: isReplacingSecret && secret.trim().length === 0,
  };
}

function initialScopes({
  connection,
  projectId,
  organizationId,
}: {
  connection: SlackConnection | undefined;
  projectId: string | undefined;
  organizationId: string | undefined;
}): ConnectionScope[] {
  if (connection) return [{ scopeType: connection.scopeType, scopeId: connection.scopeId }];
  if (projectId) return [{ scopeType: "PROJECT", scopeId: projectId }];
  if (organizationId) return [{ scopeType: "ORGANIZATION", scopeId: organizationId }];
  return [];
}
