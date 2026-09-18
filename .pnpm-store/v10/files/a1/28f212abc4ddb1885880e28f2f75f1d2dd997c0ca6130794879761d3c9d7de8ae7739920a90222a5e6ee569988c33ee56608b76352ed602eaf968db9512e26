export interface AgentCallLimits {
    /** The maximum number of concurrent conversations. -1 indicates that there is no maximum */
    agentConcurrencyLimit?: number;
    /** The maximum number of conversations per day */
    dailyLimit?: number;
    /** Whether to enable bursting. If true, exceeding workspace concurrency limit will be allowed up to 3 times the limit. Calls will be charged at double rate when exceeding the limit. */
    burstingEnabled?: boolean;
}
