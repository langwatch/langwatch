import type * as ElevenLabs from "../index";
export interface AgentSummaryResponseModel {
    /** The ID of the agent */
    agentId: string;
    /** The name of the agent */
    name: string;
    /** Agent tags used to categorize the agent */
    tags: string[];
    /** The creation time of the agent in unix seconds */
    createdAtUnixSecs: number;
    /** The access information of the agent */
    accessInfo: ElevenLabs.ResourceAccessInfo;
    /** The time of the most recent call in unix seconds, null if no calls have been made */
    lastCallTimeUnixSecs?: number;
    /** Whether the agent is archived */
    archived?: boolean;
}
