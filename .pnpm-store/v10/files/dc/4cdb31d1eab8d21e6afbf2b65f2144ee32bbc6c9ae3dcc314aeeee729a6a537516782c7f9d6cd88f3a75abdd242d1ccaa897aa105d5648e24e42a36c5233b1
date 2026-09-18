import type * as ElevenLabs from "../index";
export interface AgentBranchResponse {
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
    /** Parent branch of the branch */
    parentBranch?: ElevenLabs.AgentBranchBasicInfo;
    /** Most recent versions on the branch */
    mostRecentVersions?: ElevenLabs.AgentVersionMetadata[];
}
