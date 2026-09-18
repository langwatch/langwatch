import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { AgentBranchBasicInfo } from "./AgentBranchBasicInfo";
import { AgentVersionMetadata } from "./AgentVersionMetadata";
import { BranchProtectionStatus } from "./BranchProtectionStatus";
import { ResourceAccessInfo } from "./ResourceAccessInfo";
export declare const AgentBranchResponse: core.serialization.ObjectSchema<serializers.AgentBranchResponse.Raw, ElevenLabs.AgentBranchResponse>;
export declare namespace AgentBranchResponse {
    interface Raw {
        id: string;
        name: string;
        agent_id: string;
        description: string;
        created_at: number;
        last_committed_at: number;
        is_archived: boolean;
        protection_status?: BranchProtectionStatus.Raw | null;
        access_info?: ResourceAccessInfo.Raw | null;
        current_live_percentage?: number | null;
        parent_branch?: AgentBranchBasicInfo.Raw | null;
        most_recent_versions?: AgentVersionMetadata.Raw[] | null;
    }
}
