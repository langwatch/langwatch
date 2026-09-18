import type * as ElevenLabs from "../../api/index";
import * as core from "../../core";
import type * as serializers from "../index";
import { TopicMetricsAggregate } from "./TopicMetricsAggregate";
export declare const AgentTopicResponseModel: core.serialization.ObjectSchema<serializers.AgentTopicResponseModel.Raw, ElevenLabs.AgentTopicResponseModel>;
export declare namespace AgentTopicResponseModel {
    interface Raw {
        topic_id: string;
        label: string;
        description: string;
        conversation_count: number;
        parent_topic_id?: string | null;
        x_2d?: number | null;
        y_2d?: number | null;
        metrics?: TopicMetricsAggregate.Raw | null;
    }
}
