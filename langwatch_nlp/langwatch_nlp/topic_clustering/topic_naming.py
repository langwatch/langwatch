from concurrent.futures import Future, ThreadPoolExecutor
import math
from typing import Optional
import litellm
from litellm.cost_calculator import completion_cost
import numpy as np
from openai import AzureOpenAI, OpenAI
import os
import json
from random import random
from typing import Iterable, TypeVar, Optional

from tenacity import retry, stop_after_attempt, wait_exponential, wait_none

from langwatch_nlp.topic_clustering.types import Money, Trace
from langchain_community.callbacks.openai_info import get_openai_token_cost_for_model

T = TypeVar("T")

os.environ["AZURE_API_VERSION"] = "2024-02-01"


@retry(wait=wait_exponential(min=12, max=60), stop=stop_after_attempt(4))
def generate_topic_names(
    model: str,
    litellm_params: dict[str, str],
    topic_examples: list[list[str]],
    existing: Optional[list[str]] = None,
) -> tuple[list[str], Money]:
    example_count = sum([len(examples) for examples in topic_examples])
    print(
        f"Generating names for {len(topic_examples)} topics with {example_count} examples total."
    )
    topic_examples_str = "\n\n\n".join(
        [
            f"# Topic {index} Samples\n\n" + "\n".join(samples)
            for index, samples in enumerate(topic_examples)
        ]
    )

    existing_str = "\n".join(existing) if existing else ""
    existing_message = (
        f"\n\nThose are the topics that already exist, avoid using any names that may overlap \
        in meaning with them, think how the current sample data is unique and different from those instead:\n\n\
            {existing_str}"
        if existing_str
        else ""
    )

    try:
        response = litellm.completion(
            temperature=0.0,
            messages=[
                {
                    "role": "system",
                    "content": f'You are a highly knowledgeable assistant tasked with taxonomy for naming topics \
                        based on a list of examples. Provide a single, descriptive name for each topic. \
                        Avoid using "and" or "&" in the name, try to summarize it with a single concept. \
                        Topic names should not be similar to each other, as the data is already organized, \
                        the disambiguation between two similar topics should be clear from the name alone.\
                            {existing_message}',
                },
                {"role": "user", "content": f"{topic_examples_str}"},
            ],
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "topicNames",
                        "parameters": {
                            "type": "object",
                            "properties": dict(
                                [
                                    (f"topic_{index}", {"type": "string"})
                                    for index in range(len(topic_examples))
                                ]
                            ),
                        },
                        "description": 'use this function to name the topics based on the examples provided, avoid using "and" or "&" in the name, try to name it with a single 2-3 words concept.',
                    },
                }
            ],
            tool_choice={"type": "function", "function": {"name": "topicNames"}},
            **litellm_params,  # type: ignore
        )
    except Exception as e:
        print(f"Failed to generate topic names for {len(topic_examples)} topics: {e}")
        raise e

    total_cost = completion_cost(response)

    topic_names: list[str] = list(json.loads(response.choices[0].message.tool_calls[0].function.arguments).values())  # type: ignore
    topic_names = topic_names[0 : len(topic_examples)]
    if len(topic_names) != len(topic_examples):
        raise ValueError("topic_names and topic_examples must have the same length.")

    return topic_names, Money(amount=total_cost, currency="USD")


def shuffled(x: Iterable[T]) -> list[T]:
    return sorted(x, key=lambda _: random())


def get_subtopic_samples(samples: list[Trace], n=5):
    unique_values = list(set([item["input"] for item in samples]))
    return [item[0:140] for item in shuffled(unique_values)[0:n]]


def generate_topic_names_split(
    model: str,
    litellm_params: dict[str, str],
    topic_examples: list[list[str]],
    existing: Optional[list[str]] = None,
) -> tuple[list[Optional[str]], Money]:
    total_samples = sum([len(examples) for examples in topic_examples])
    split_point = min(
        math.ceil(total_samples / max(1, math.ceil(total_samples / 150))), 150
    )

    batch: list[list[str]] = []

    results: list[Optional[str]] = []
    cost = Money(amount=0, currency="USD")
    for examples in topic_examples:
        batch.append(examples)
        batch_len = sum([len(examples) for examples in batch])

        if batch_len >= split_point:
            try:
                result, cost_ = generate_topic_names(
                    model, litellm_params, batch, existing
                )
                cost["amount"] += cost_["amount"]
                results += result
            except Exception as e:
                results += [None] * len(batch)
            batch = []

    if len(batch) > 0:
        try:
            result, cost_ = generate_topic_names(model, litellm_params, batch, existing)
            cost["amount"] += cost_["amount"]
            results += result
        except Exception as e:
            results += [None] * len(batch)

    return results, cost


def generate_topic_names_split_and_improve_similar_names(
    model: str,
    litellm_params: dict[str, str],
    embeddings_litellm_params: dict[str, str],
    topic_examples: list[list[str]],
    existing: Optional[list[str]] = None,
) -> tuple[list[Optional[str]], Money]:
    topic_names, cost1 = generate_topic_names_split(
        model,
        litellm_params,
        topic_examples=topic_examples,
        existing=existing,
    )
    topic_names, cost2 = improve_similar_names(
        model,
        litellm_params,
        embeddings_litellm_params,
        topic_names=topic_names,
        topic_examples=topic_examples,
        max_iterations=3,
    )
    return topic_names, Money(amount=cost1["amount"] + cost2["amount"], currency="USD")


def improve_similar_names(
    model: str,
    litellm_params: dict[str, str],
    embeddings_litellm_params: dict[str, str],
    topic_names: list[Optional[str]],
    topic_examples: list[list[str]],
    cost=Money(amount=0, currency="USD"),
    iteration=0,
    max_iterations=3,
) -> tuple[list[Optional[str]], Money]:

    if len(topic_names) != len(topic_examples):
        raise ValueError("topic_names and topic_examples must have the same length.")

    # Temporary until text-embedding-3-small is also available on azure: https://learn.microsoft.com/en-us/answers/questions/1531681/openai-new-embeddings-model
    response = litellm.embedding(
        **embeddings_litellm_params,  # type: ignore
        input=[name if name else "" for name in topic_names],
    )
    embeddings = [data["embedding"] for data in response.data or []]

    # find the two closest embeddings
    closest_distance = float("inf")
    closest_pair = None
    for i, embedding_a in enumerate(embeddings):
        for j, embedding_b in enumerate(embeddings):
            if i == j or topic_names[i] is None or topic_names[j] is None:
                continue
            # calculate cosine distance
            distance = 1 - np.dot(embedding_a, embedding_b) / (
                np.linalg.norm(embedding_a) * np.linalg.norm(embedding_b)
            )
            if distance < closest_distance:
                closest_distance = distance
                closest_pair = (i, j)

    if closest_distance > 0.6 or not closest_pair:
        print(
            f"No similar names found (iteration {iteration + 1}), stopping improvement."
        )
        return topic_names, cost

    topic_a_index, topic_b_index = closest_pair
    topic_a_name = topic_names[topic_a_index]
    topic_b_name = topic_names[topic_b_index]
    topic_a_examples = topic_examples[topic_a_index]
    topic_b_examples = topic_examples[topic_b_index]

    num_examples_a = len(topic_a_examples)
    num_examples_b = len(topic_b_examples)
    print(
        f'Improving names (iteration {iteration + 1}) between "{topic_a_name}" ({num_examples_a} examples) and "{topic_b_name}" ({num_examples_b} examples) (cosine distance {closest_distance})'
    )

    new_topic_a_name, new_topic_b_name, cost_ = improve_name_between_two_topics(
        model,
        litellm_params,
        topic_a_name,
        topic_b_name,
        topic_a_examples,
        topic_b_examples,
    )

    topic_names_ = topic_names.copy()
    topic_names_[topic_a_index] = new_topic_a_name
    topic_names_[topic_b_index] = new_topic_b_name

    cost__ = Money(amount=cost["amount"] + cost_["amount"], currency="USD")

    iteration_ = iteration + 1
    if iteration_ < max_iterations:
        return improve_similar_names(
            model,
            litellm_params,
            embeddings_litellm_params,
            topic_names=topic_names_,
            topic_examples=topic_examples,
            cost=cost__,
            iteration=iteration_,
            max_iterations=max_iterations,
        )

    return topic_names_, cost__


@retry(wait=wait_exponential(min=12, max=60), stop=stop_after_attempt(4))
def improve_name_between_two_topics(
    model: str,
    litellm_params: dict[str, str],
    topic_a_name: Optional[str],
    topic_b_name: Optional[str],
    topic_a_examples: list[str],
    topic_b_examples: list[str],
) -> tuple[Optional[str], Optional[str], Money]:
    if topic_a_name is None or topic_b_name is None:
        return topic_a_name, topic_b_name, Money(amount=0, currency="USD")

    topic_examples_str = (
        (f"# Topic A: {topic_a_name}\n\n" + "\n".join(topic_a_examples))
        + f"\n\n# Topic B: {topic_b_name}\n\n"
        + "\n".join(topic_b_examples)
    )

    response = litellm.completion(
        temperature=0.0,
        messages=[
            {
                "role": "system",
                "content": f"You are a highly knowledgeable assistant tasked with taxonomy for naming topics, \
                    right now we have two topics with very similar names, and we need to disambiguate between them, \
                    to have a better name that really contrasts what one topic is about versus the other. \
                    Please look at the topics A and B and come up with a new, concise but constrasting name for each, \
                    based on their examples.",
            },
            {"role": "user", "content": f"{topic_examples_str}"},
        ],
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "topicNames",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "topic_a": {"type": "string"},
                            "topic_b": {"type": "string"},
                        },
                    },
                    "description": 'use this function to name the topics based on the examples provided, avoid using "and" or "&" in the name, try to name it with a single 2-3 words concept.',
                },
            }
        ],
        tool_choice={"type": "function", "function": {"name": "topicNames"}},
        **litellm_params,  # type: ignore
    )

    total_cost = completion_cost(response)

    arguments = json.loads(response.choices[0].message.tool_calls[0].function.arguments)  # type: ignore
    new_topic_a_name = arguments["topic_a"]
    new_topic_b_name = arguments["topic_b"]

    print(f'New names: "{new_topic_a_name}" and "{new_topic_b_name}"')

    return new_topic_a_name, new_topic_b_name, Money(amount=total_cost, currency="USD")


def generate_topic_and_subtopic_names(
    model: str,
    litellm_params: dict[str, str],
    embeddings_litellm_params: dict[str, str],
    hierarchy: dict[str, dict[str, list[Trace]]],
    existing: Optional[list[str]] = None,
    skip_topic_names: bool = False,
) -> tuple[list[Optional[str]], list[list[Optional[str]]], Money]:
    with ThreadPoolExecutor() as executor:
        cost = Money(amount=0, currency="USD")
        topic_examples = [
            shuffled(
                [
                    item
                    for samples in subtopics.values()
                    for item in get_subtopic_samples(samples, n=5)
                ]
            )[0:30]
            for subtopics in hierarchy.values()
        ]

        def noop_topic_names(
            model: str,
            litellm_params: dict[str, str],
            embeddings_litellm_params: dict[str, str],
            topic_examples: list[list[str]],
            existing: Optional[list[str]] = None,
        ) -> tuple[list[Optional[str]], Money]:
            return list(hierarchy.keys()), Money(amount=0, currency="USD")

        topic_future = executor.submit(
            (
                noop_topic_names
                if skip_topic_names
                else generate_topic_names_split_and_improve_similar_names
            ),
            model,
            litellm_params,
            embeddings_litellm_params,
            topic_examples,
            existing=existing,
        )

        subtopic_names = []
        futures: list[Future[tuple[list[Optional[str]], Money]]] = []

        for subtopics in hierarchy.values():
            subtopic_samples = [
                get_subtopic_samples(samples, n=20) for samples in subtopics.values()
            ]
            future = executor.submit(
                generate_topic_names_split_and_improve_similar_names,
                model,
                litellm_params,
                embeddings_litellm_params,
                subtopic_samples,
                existing,
            )
            futures.append(future)

        topic_names, cost_ = topic_future.result()
        cost["amount"] += cost_["amount"]

        for future in futures:
            subtopic_names_, cost_ = future.result()
            cost["amount"] += cost_["amount"]
            subtopic_names.append(subtopic_names_)

    return topic_names, subtopic_names, cost
