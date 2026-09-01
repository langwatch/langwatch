import { GovernanceOttlValidationClient, type GovernanceOttlValidationResult } from "../../model/governance-ottl-validation-client";
import { OttlEditor } from "../elements/ottl-editor";
import { useMemo } from "react";
import { api } from "../../../../behavior/governance-api";
class AppGovernanceOttlValidationClient extends GovernanceOttlValidationClient {
  private constructor(
    private readonly validateOttl: (input: {
      organizationId: string;
      statements: string[];
    }) => Promise<GovernanceOttlValidationResult>,
  ) {
    super();
  }

  static create(
    validateOttl: (input: {
      organizationId: string;
      statements: string[];
    }) => Promise<GovernanceOttlValidationResult>,
  ): AppGovernanceOttlValidationClient {
    return new AppGovernanceOttlValidationClient(validateOttl);
  }

  validate(input: {
    organizationId: string;
    statements: string[];
  }): Promise<GovernanceOttlValidationResult> {
    return this.validateOttl(input);
  }
}

export function EnterpriseOttlEditor({
  organizationId,
  sourceType,
  statements,
  onChange,
  enabled,
}: {
  organizationId: string;
  sourceType: string;
  statements: string[];
  onChange: (next: string[]) => void;
  enabled: boolean;
}) {
  const starterQuery = api.ingestionSources.ottlStarter.useQuery(
    { organizationId, sourceType },
    {
      enabled: enabled && !!organizationId && !!sourceType,
      refetchOnWindowFocus: false,
    },
  );
  const { mutateAsync: validateOttl } = api.ingestionSources.validateOttl.useMutation();
  const client = useMemo(
    () => AppGovernanceOttlValidationClient.create((input) => validateOttl(input)),
    [validateOttl],
  );

  return (
    <OttlEditor
      organizationId={organizationId}
      sourceType={sourceType}
      statements={statements}
      onChange={onChange}
      enabled={enabled}
      starterStatements={starterQuery.data?.statements}
      validationClient={client}
    />
  );
}
