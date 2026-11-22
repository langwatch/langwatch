/**
 * Cross-pod word that a device code settled, so the approval stream the CLI
 * waits on can end early. Best effort: the CLI's own poll is the correctness floor.
 */
export abstract class CliDeviceSettlementChannel {
  /** Announces `approved` or `denied`; never fails the approval that settled it. */
  abstract publish(input: { deviceCode: string; status: string }): Promise<void>;

  /** Resolves once the listener is live, with the release that stops it. */
  abstract listen(input: {
    deviceCode: string;
    onSettled: (status: string) => void;
  }): Promise<() => void>;
}
