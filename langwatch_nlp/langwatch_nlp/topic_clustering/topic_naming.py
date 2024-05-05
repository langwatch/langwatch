from concurrent.futures import Future, ThreadPoolExecutor
import math
from typing import Optional
import numpy as np
from openai import AzureOpenAI, OpenAI
import os
import json
from random import random
from typing import Iterable, TypeVar, Optional

from tenacity import retry, stop_after_attempt, wait_exponential

from langwatch_nlp.topic_clustering.types import Money, Trace
from langchain_community.callbacks.openai_info import get_openai_token_cost_for_model

T = TypeVar("T")

azure_openai = AzureOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT") or "",
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2023-07-01-preview",
)


@retry(wait=wait_exponential(min=12, max=60), stop=stop_after_attempt(4))
def generate_topic_names(
    topic_examples: list[list[str]], existing: Optional[list[str]] = None
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

    model_name = "gpt-4-1106-preview"
    response = azure_openai.chat.completions.create(
        model=model_name,
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
    )

    total_cost = 0
    if response.usage:
        # TODO: use litellm here instead
        prompt_cost = get_openai_token_cost_for_model(
            model_name.replace("35", "3.5"), response.usage.prompt_tokens
        )
        completion_cost = get_openai_token_cost_for_model(
            model_name.replace("35", "3.5"),
            response.usage.completion_tokens,
            is_completion=True,
        )
        total_cost = prompt_cost + completion_cost

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
    topic_examples: list[list[str]], existing: Optional[list[str]] = None
) -> tuple[list[str], Money]:
    total_samples = sum([len(examples) for examples in topic_examples])
    split_point = min(
        math.ceil(total_samples / max(1, math.ceil(total_samples / 150))), 150
    )

    batch: list[list[str]] = []

    results: list[str] = []
    cost = Money(amount=0, currency="USD")
    for examples in topic_examples:
        batch.append(examples)
        batch_len = sum([len(examples) for examples in batch])

        if batch_len >= split_point:
            result, cost_ = generate_topic_names(batch, existing)
            cost["amount"] += cost_["amount"]
            results += result
            batch = []

    if len(batch) > 0:
        result, cost_ = generate_topic_names(batch, existing)
        cost["amount"] += cost_["amount"]
        results += result

    return results, cost


def generate_topic_names_split_and_improve_similar_names(
    topic_examples: list[list[str]], existing: Optional[list[str]] = None
) -> tuple[list[str], Money]:
    topic_names, cost1 = generate_topic_names_split(topic_examples, existing)
    topic_names, cost2 = improve_similar_names(
        topic_names, topic_examples, max_iterations=3
    )
    return topic_names, Money(amount=cost1["amount"] + cost2["amount"], currency="USD")


def improve_similar_names(
    topic_names: list[str],
    topic_examples: list[list[str]],
    cost=Money(amount=0, currency="USD"),
    iteration=0,
    max_iterations=3,
) -> tuple[list[str], Money]:
    if len(topic_names) != len(topic_examples):
        raise ValueError("topic_names and topic_examples must have the same length.")

    openai_client = OpenAI(
        api_key=os.getenv("OPENAI_API_KEY"),
    )
    # Temporary until text-embedding-3-small is also available on azure: https://learn.microsoft.com/en-us/answers/questions/1531681/openai-new-embeddings-model
    response = openai_client.embeddings.create(
        input=topic_names, model="text-embedding-3-small"
    )
    embeddings = [data.embedding for data in response.data]

    # find the two closest embeddings
    closest_distance = float("inf")
    closest_pair = None
    for i, embedding_a in enumerate(embeddings):
        for j, embedding_b in enumerate(embeddings):
            if i == j:
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
        topic_a_name, topic_b_name, topic_a_examples, topic_b_examples
    )

    topic_names_ = topic_names.copy()
    topic_names_[topic_a_index] = new_topic_a_name
    topic_names_[topic_b_index] = new_topic_b_name

    cost__ = Money(amount=cost["amount"] + cost_["amount"], currency="USD")

    iteration_ = iteration + 1
    if iteration_ < max_iterations:
        return improve_similar_names(
            topic_names_,
            topic_examples,
            cost=cost__,
            iteration=iteration_,
            max_iterations=max_iterations,
        )

    return topic_names_, cost__


@retry(wait=wait_exponential(min=12, max=60), stop=stop_after_attempt(4))
def improve_name_between_two_topics(
    topic_a_name: str,
    topic_b_name: str,
    topic_a_examples: list[str],
    topic_b_examples: list[str],
) -> tuple[str, str, Money]:
    model_name = "gpt-4-1106-preview"

    topic_examples_str = (
        (f"# Topic A: {topic_a_name}\n\n" + "\n".join(topic_a_examples))
        + f"\n\n# Topic B: {topic_b_name}\n\n"
        + "\n".join(topic_b_examples)
    )

    response = azure_openai.chat.completions.create(
        model=model_name,
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
    )

    total_cost = 0
    if response.usage:
        # TODO: use litellm here instead
        prompt_cost = get_openai_token_cost_for_model(
            model_name.replace("35", "3.5"), response.usage.prompt_tokens
        )
        completion_cost = get_openai_token_cost_for_model(
            model_name.replace("35", "3.5"),
            response.usage.completion_tokens,
            is_completion=True,
        )
        total_cost = prompt_cost + completion_cost

    arguments = json.loads(response.choices[0].message.tool_calls[0].function.arguments)  # type: ignore
    new_topic_a_name = arguments["topic_a"]
    new_topic_b_name = arguments["topic_b"]

    print(f'New names: "{new_topic_a_name}" and "{new_topic_b_name}"')

    return new_topic_a_name, new_topic_b_name, Money(amount=total_cost, currency="USD")


def generate_topic_and_subtopic_names(
    hierarchy: dict[str, dict[str, list[Trace]]],
    existing: Optional[list[str]] = None,
    skip_topic_names: bool = False,
):
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

        def noop_topic_names(topic_examples, existing):
            return list(hierarchy.keys()), Money(amount=0, currency="USD")

        topic_future = executor.submit(
            (
                noop_topic_names
                if skip_topic_names
                else generate_topic_names_split_and_improve_similar_names
            ),
            topic_examples,
            existing=existing,
        )

        subtopic_names = []
        futures: list[Future[tuple[list[str], Money]]] = []

        for subtopics in hierarchy.values():
            subtopic_samples = [
                get_subtopic_samples(samples, n=20) for samples in subtopics.values()
            ]
            future = executor.submit(
                generate_topic_names_split_and_improve_similar_names,
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
