import { ModelProviderManagedGateway } from "../app/model-provider.members.ts";

/**
 * The managed-provider answer for a deployment that has none.
 *
 * Named rather than defaulted: "no organization is managed, and parameters
 * travel unchanged" is the true answer for every self-hosted install, and
 * stating it here is what keeps a deployment that DOES have managed providers
 * from getting it by omission.
 */
export class UnmanagedModelProviderGatewayAdapter extends ModelProviderManagedGateway {
  static create(): UnmanagedModelProviderGatewayAdapter {
    return new UnmanagedModelProviderGatewayAdapter();
  }

  isManaged(_input: { organizationId: string; provider: string }): boolean {
    return false;
  }

  prepareParameters(input: {
    parameters: Record<string, string>;
    projectId: string;
    model: string;
    provider: string;
  }): Promise<Record<string, string>> {
    return Promise.resolve(input.parameters);
  }
}
