import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { WorkflowEndNodeModelInput } from "./WorkflowEndNodeModelInput";
import { WorkflowOverrideAgentNodeModelInput } from "./WorkflowOverrideAgentNodeModelInput";
import { WorkflowPhoneNumberNodeModelInput } from "./WorkflowPhoneNumberNodeModelInput";
import { WorkflowStandaloneAgentNodeModelInput } from "./WorkflowStandaloneAgentNodeModelInput";
import { WorkflowStartNodeModelInput } from "./WorkflowStartNodeModelInput";
import { WorkflowToolNodeModelInput } from "./WorkflowToolNodeModelInput";
export declare const AgentWorkflowRequestModelNodesValue: core.serialization.Schema<serializers.AgentWorkflowRequestModelNodesValue.Raw, ElevenLabs.AgentWorkflowRequestModelNodesValue>;
export declare namespace AgentWorkflowRequestModelNodesValue {
    type Raw = AgentWorkflowRequestModelNodesValue.End | AgentWorkflowRequestModelNodesValue.OverrideAgent | AgentWorkflowRequestModelNodesValue.PhoneNumber | AgentWorkflowRequestModelNodesValue.StandaloneAgent | AgentWorkflowRequestModelNodesValue.Start | AgentWorkflowRequestModelNodesValue.Tool;
    interface End extends WorkflowEndNodeModelInput.Raw {
        type: "end";
    }
    interface OverrideAgent extends WorkflowOverrideAgentNodeModelInput.Raw {
        type: "override_agent";
    }
    interface PhoneNumber extends WorkflowPhoneNumberNodeModelInput.Raw {
        type: "phone_number";
    }
    interface StandaloneAgent extends WorkflowStandaloneAgentNodeModelInput.Raw {
        type: "standalone_agent";
    }
    interface Start extends WorkflowStartNodeModelInput.Raw {
        type: "start";
    }
    interface Tool extends WorkflowToolNodeModelInput.Raw {
        type: "tool";
    }
}
