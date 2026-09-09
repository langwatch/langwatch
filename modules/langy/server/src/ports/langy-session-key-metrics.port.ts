/**
 * The session-key lifecycle counter, as the feature reports into it.
 *
 * Minting, revoking and reaping are three moments in one credential's life and
 * they are counted as one series with an operation label, so a dashboard can
 * read minted-minus-revoked as the live population without joining two metrics.
 *
 * It is a port because the two processes that run these operations export
 * differently: the App writes into its own `prom-client` registry, and a worker
 * composed from packages pushes over OTLP. Both write the same series name.
 */
export abstract class LangySessionKeyMetricsPort {
  abstract record(input: { operation: "minted" | "revoked" | "reaped"; count?: number }): void;
}
