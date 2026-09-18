import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { ResourceAccessInfo } from "./ResourceAccessInfo";
export declare const AgentSummaryResponseModel: core.serialization.ObjectSchema<serializers.AgentSummaryResponseModel.Raw, ElevenLabs.AgentSummaryResponseModel>;
export declare namespace AgentSummaryResponseModel {
    interface Raw {
        agent_id: string;
        name: string;
        tags: string[];
        created_at_unix_secs: number;
        access_info: ResourceAccessInfo.Raw;
        last_call_time_unix_secs?: number | null;
        archived?: boolean | null;
    }
}
