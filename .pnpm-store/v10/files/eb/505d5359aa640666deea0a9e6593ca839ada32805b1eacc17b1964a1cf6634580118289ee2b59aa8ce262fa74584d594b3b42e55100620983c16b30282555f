import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { WorkflowEndNodeModelOutput } from "./WorkflowEndNodeModelOutput";
import { WorkflowOverrideAgentNodeModelOutput } from "./WorkflowOverrideAgentNodeModelOutput";
import { WorkflowPhoneNumberNodeModelOutput } from "./WorkflowPhoneNumberNodeModelOutput";
import { WorkflowStandaloneAgentNodeModelOutput } from "./WorkflowStandaloneAgentNodeModelOutput";
import { WorkflowStartNodeModelOutput } from "./WorkflowStartNodeModelOutput";
import { WorkflowToolNodeModelOutput } from "./WorkflowToolNodeModelOutput";
export declare const AgentWorkflowResponseModelNodesValue: core.serialization.Schema<serializers.AgentWorkflowResponseModelNodesValue.Raw, ElevenLabs.AgentWorkflowResponseModelNodesValue>;
export declare namespace AgentWorkflowResponseModelNodesValue {
    type Raw = AgentWorkflowResponseModelNodesValue.End | AgentWorkflowResponseModelNodesValue.OverrideAgent | AgentWorkflowResponseModelNodesValue.PhoneNumber | AgentWorkflowResponseModelNodesValue.StandaloneAgent | AgentWorkflowResponseModelNodesValue.Start | AgentWorkflowResponseModelNodesValue.Tool;
    interface End extends WorkflowEndNodeModelOutput.Raw {
        type: "end";
    }
    interface OverrideAgent extends WorkflowOverrideAgentNodeModelOutput.Raw {
        type: "override_agent";
    }
    interface PhoneNumber extends WorkflowPhoneNumberNodeModelOutput.Raw {
        type: "phone_number";
    }
    interface StandaloneAgent extends WorkflowStandaloneAgentNodeModelOutput.Raw {
        type: "standalone_agent";
    }
    interface Start extends WorkflowStartNodeModelOutput.Raw {
        type: "start";
    }
    interface Tool extends WorkflowToolNodeModelOutput.Raw {
        type: "tool";
    }
}
