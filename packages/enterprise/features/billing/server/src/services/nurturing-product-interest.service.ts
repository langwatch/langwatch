import { reportNurturingFailure, tryNurturingSink } from "./nurturing-sink";
import type { CioPersonTraits } from "@langwatch/enterprise-billing-contract";

/**
 * Valid integration method trait values sent to Customer.io.
 */
export type IntegrationMethodValue = "coding_agent" | "platform" | "mcp" | "manual_sdk";

export class NurturingProductInterestService {
  static create(): NurturingProductInterestService {
    return new NurturingProductInterestService();
  }

  /**
   * Maps the UI product selection key to the Customer.io integration_method trait value.
   */
  static integrationMethodFor(selection: string): IntegrationMethodValue {
    const mapping: Record<string, IntegrationMethodValue> = {
      "via-claude-code": "coding_agent",
      "via-platform": "platform",
      "via-claude-desktop": "mcp",
      manually: "manual_sdk",
    };

    if (!Object.hasOwn(mapping, selection)) {
      throw new Error(`Unknown product selection: ${selection}`);
    }

    return mapping[selection]!;
  }

  /**
   * Fires a separate identifyUser call to set the integration_method trait.
   */
  static fireIntegrationMethod({
    userId,
    integrationMethod,
  }: {
    userId: string;
    integrationMethod: IntegrationMethodValue;
  }): void {
    const nurturing = tryNurturingSink();
    if (!nurturing) {
      return;
    }

    void nurturing
      .identifyUser({
        userId,
        traits: {
          integration_method: integrationMethod,
        } as Partial<CioPersonTraits>,
      })
      .catch(reportNurturingFailure);
  }
}
