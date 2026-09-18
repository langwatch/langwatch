import type * as ElevenLabs from "../index";
export interface AgentBranchSummary {
    id: string;
    name: string;
    agentId: string;
    description: string;
    createdAt: number;
    lastCommittedAt: number;
    isArchived: boolean;
    protectionStatus?: ElevenLabs.BranchProtectionStatus;
    /** Access information for the branch */
    accessInfo?: ElevenLabs.ResourceAccessInfo;
    /** Percentage of traffic live on the branch */
    currentLivePercentage?: number;
    /** ID of the parent branch */
    parentBranchId?: string;
    /** Whether a draft exists for the branch */
    draftExists?: boolean;
    /** Number of calls in the last 7 days */
    calls7D?: number;
}
