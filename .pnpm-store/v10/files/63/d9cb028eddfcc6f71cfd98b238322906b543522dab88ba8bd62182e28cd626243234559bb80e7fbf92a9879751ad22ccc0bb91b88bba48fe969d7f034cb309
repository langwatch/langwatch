import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { AgentTransferOpPop } from "./AgentTransferOpPop";
import { AgentTransferOpPush } from "./AgentTransferOpPush";
import { AgentTransferOpReplace } from "./AgentTransferOpReplace";
export declare const AgentTransferOp: core.serialization.Schema<serializers.AgentTransferOp.Raw, ElevenLabs.AgentTransferOp>;
export declare namespace AgentTransferOp {
    type Raw = AgentTransferOp.Pop | AgentTransferOp.Push | AgentTransferOp.Replace;
    interface Pop extends AgentTransferOpPop.Raw {
        type: "pop";
    }
    interface Push extends AgentTransferOpPush.Raw {
        type: "push";
    }
    interface Replace extends AgentTransferOpReplace.Raw {
        type: "replace";
    }
}
