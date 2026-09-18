import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { AgentWorkflowRequestModelNodesValue } from "./AgentWorkflowRequestModelNodesValue";
import { WorkflowEdgeModelInput } from "./WorkflowEdgeModelInput";
export declare const AgentWorkflowRequestModel: core.serialization.ObjectSchema<serializers.AgentWorkflowRequestModel.Raw, ElevenLabs.AgentWorkflowRequestModel>;
export declare namespace AgentWorkflowRequestModel {
    interface Raw {
        edges?: Record<string, WorkflowEdgeModelInput.Raw> | null;
        nodes?: Record<string, AgentWorkflowRequestModelNodesValue.Raw> | null;
        prevent_subagent_loops?: boolean | null;
    }
}
