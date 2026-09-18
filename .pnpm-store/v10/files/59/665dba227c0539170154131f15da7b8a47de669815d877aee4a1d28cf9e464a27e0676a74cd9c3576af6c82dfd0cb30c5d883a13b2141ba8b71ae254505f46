import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { AgentVersionParents } from "./AgentVersionParents";
import { ResourceAccessInfo } from "./ResourceAccessInfo";
export declare const AgentVersionMetadata: core.serialization.ObjectSchema<serializers.AgentVersionMetadata.Raw, ElevenLabs.AgentVersionMetadata>;
export declare namespace AgentVersionMetadata {
    interface Raw {
        id: string;
        agent_id: string;
        branch_id: string;
        version_description: string;
        seq_no_in_branch: number;
        time_committed_secs: number;
        parents: AgentVersionParents.Raw;
        access_info?: ResourceAccessInfo.Raw | null;
    }
}
