import type * as ElevenLabs from "../index";
/**
 * Alerting configuration used at both per-agent and per-workspace level.
 *
 * All fields are optional overrides; the cascade resolver fills in defaults
 * when they are unset. Notifiers stack and dedupe (by URL) across the
 * workspace and agent layers rather than overriding each other.
 *
 * Cascade order for per-monitor threshold and auto-resolve: agent → workspace →
 * system default.
 */
export interface AlertingSettings {
    /** Alerting configuration keyed by monitor name. */
    monitorConfigs?: Record<string, ElevenLabs.AlertingMonitorConfig>;
    /** How many minutes an alert can stay inactive before it is auto-resolved. Unset values fall through to the next layer. */
    autoResolveAfterInactiveMinutes?: number;
    /** Delivery channels for alert lifecycle notifications. Stacked and deduped by URL with other layers. */
    notifiers?: ElevenLabs.AlertingWebhookNotifier[];
}
