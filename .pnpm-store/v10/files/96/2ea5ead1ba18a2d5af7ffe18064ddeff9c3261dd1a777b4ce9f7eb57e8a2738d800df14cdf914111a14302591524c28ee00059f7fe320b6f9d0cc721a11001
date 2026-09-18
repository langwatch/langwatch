import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { BranchProtectionStatus } from "./BranchProtectionStatus";
import { ResourceAccessInfo } from "./ResourceAccessInfo";
export declare const AgentBranchSummary: core.serialization.ObjectSchema<serializers.AgentBranchSummary.Raw, ElevenLabs.AgentBranchSummary>;
export declare namespace AgentBranchSummary {
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
        parent_branch_id?: string | null;
        draft_exists?: boolean | null;
        calls_7d?: number | null;
    }
}
