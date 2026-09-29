import { useState } from "react";
import type {
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { SlackFieldRefusal } from "./slackConnectionCopy";
import type { SlackConnection } from "./slackConnectionTypes";

export interface ConnectionScope {
  scopeType: SlackIntegrationScopeType;
  scopeId: string;
}

export interface SlackConnectionDraft {
  kind: SlackIntegrationKind;
  name: string;
  scope: ConnectionScope;
  secret: string | undefined;
}

/** The form's field state; `submit` hands back a draft, or marks the missing fields and returns nothing. */
export function useSlackConnectionFormState({
  connection,
  canManageProject,
  canManageOrganization,
}: {
  connection: SlackConnection | undefined;
  canManageProject: boolean;
  canManageOrganization: boolean;
}) {
  const { organization, project } = useOrganizationTeamProject();
  const [kind, setKind] = useState<SlackIntegrationKind>(
    connection?.kind ?? "BOT",
  );
  const [name, setName] = useState(connection?.name ?? "");
  const [scopes, setScopes] = useState<ConnectionScope[]>(() =>
    initialScopes({
      connection,
      projectId: canManageProject ? project?.id : undefined,
      organizationId: canManageOrganization ? organization?.id : undefined,
    }),
  );
  const [secret, setSecret] = useState("");
  const [isReplacingSecret, setIsReplacingSecret] = useState(!connection);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const scope = scopes[0];
  const missing = missingFields({ name, scope, secret, isReplacingSecret });
  const errors = hasAttemptedSubmit ? missing : NO_ERRORS;

  const submit = (): SlackConnectionDraft | undefined => {
    setHasAttemptedSubmit(true);
    if (!scope || missing.name || missing.secret) return undefined;
    return {
      kind,
      name: name.trim(),
      scope,
      secret: isReplacingSecret ? secret.trim() : undefined,
    };
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
  return {
    scope: missing.scope ? "Choose who can use the connection." : refusal.scope,
    secret: missing.secret
      ? isBot
        ? "Paste the bot token."
        : "Paste the webhook URL."
      : refusal.secret,
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
  if (connection) {
    return [{ scopeType: connection.scopeType, scopeId: connection.scopeId }];
  }
  if (projectId) return [{ scopeType: "PROJECT", scopeId: projectId }];
  if (organizationId) {
    return [{ scopeType: "ORGANIZATION", scopeId: organizationId }];
  }
  return [];
}
