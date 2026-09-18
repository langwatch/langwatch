import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { AgentWorkflowResponseModelNodesValue } from "./AgentWorkflowResponseModelNodesValue";
import { WorkflowEdgeModelOutput } from "./WorkflowEdgeModelOutput";
export declare const AgentWorkflowResponseModel: core.serialization.ObjectSchema<serializers.AgentWorkflowResponseModel.Raw, ElevenLabs.AgentWorkflowResponseModel>;
export declare namespace AgentWorkflowResponseModel {
    interface Raw {
        edges: Record<string, WorkflowEdgeModelOutput.Raw>;
        nodes: Record<string, AgentWorkflowResponseModelNodesValue.Raw>;
        prevent_subagent_loops: boolean;
    }
}
