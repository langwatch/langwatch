from typing import Optional
import nanoid
from langwatch_nlp.topic_clustering.constants import (
    MINIMUM_SUBTOPICS_PER_TOPIC,
    MINIMUM_TRACES_PER_TOPIC,
)
from langwatch_nlp.topic_clustering.utils import calculate_centroid_and_distance
from langwatch_nlp.topic_clustering.types import Subtopic, Topic, Trace, TraceTopicMap


def build_response(
    hierarchy: dict[str, dict[str, list[Trace]]],
    topic_names: list[Optional[str]],
    subtopic_names: list[list[Optional[str]]],
) -> tuple[list[Topic], list[Subtopic], list[TraceTopicMap]]:
    topics: list[Topic] = []
    subtopics: list[Subtopic] = []
    traces: list[TraceTopicMap] = []

    for topic_idx, topic in enumerate(hierarchy.values()):
        topic_id = None

        topic_samples = [
            item for subtopic_samples in topic.values() for item in subtopic_samples
        ]
        unique_values = list(set([item["input"] for item in topic_samples]))
        topic_name = topic_names[topic_idx]
        if (
            len(topic.values()) >= MINIMUM_SUBTOPICS_PER_TOPIC
            and len(unique_values) >= MINIMUM_TRACES_PER_TOPIC
            and topic_name is not None
        ):
            topic_id = f"topic_{nanoid.generate()}"
            topic_centroid, topic_p95_distance = calculate_centroid_and_distance(
                topic_samples
            )

            topics.append(
                Topic(
                    id=topic_id,
                    name=topic_name,
                    centroid=topic_centroid.tolist(),
                    p95_distance=topic_p95_distance,
                )
            )

        for subtopic_idx, subtopic in enumerate(topic.values()):
            subtopic_id = None

            unique_values = list(set([item["input"] for item in subtopic]))
            subtopic_name = subtopic_names[topic_idx][subtopic_idx]
            if topic_id and len(unique_values) >= MINIMUM_TRACES_PER_TOPIC and subtopic_name is not None:
                subtopic_id = f"subtopic_{nanoid.generate()}"
                subtopic_centroid, subtopic_p95_distance = (
                    calculate_centroid_and_distance(subtopic)
                )

                subtopics.append(
                    Subtopic(
                        id=subtopic_id,
                        name=subtopic_name,
                        centroid=subtopic_centroid.tolist(),
                        p95_distance=subtopic_p95_distance,
                        parent_id=topic_id,
                    )
                )

            for trace in subtopic:
                traces.append(
                    TraceTopicMap(
                        trace_id=trace["trace_id"],
                        topic_id=topic_id,
                        subtopic_id=subtopic_id,
                    )
                )

    return topics, subtopics, traces
