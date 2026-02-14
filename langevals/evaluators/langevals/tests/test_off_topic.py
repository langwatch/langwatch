import dotenv

dotenv.load_dotenv()

from langevals_langevals.off_topic import (
    OffTopicEvaluator,
    OffTopicEntry,
    OffTopicSettings,
    AllowedTopic,
)


def test_off_topic_evaluator():
    entry = OffTopicEntry(input="delete the last email please")
    settings = OffTopicSettings(
        allowed_topics=[
            AllowedTopic(topic="email_query", description="Questions about emails"),
            AllowedTopic(topic="email_delete", description="Delete an email"),
            AllowedTopic(topic="email_write", description="Write an email"),
        ],
        model="openai/gpt-5"
    )
    evaluator = OffTopicEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score >= 0.75
    assert result.details == f"Detected intent: email_delete"
    assert result.label == "email_delete"
    assert result.cost
    assert result.cost.amount > 0

    entry = OffTopicEntry(input="do i have emails")
    settings = OffTopicSettings(
        allowed_topics=[
            AllowedTopic(
                topic="medical_treatment",
                description="Question about medical treatment",
            ),
            AllowedTopic(
                topic="doctor_contact",
                description="Request to access doctor's phone number",
            ),
            AllowedTopic(
                topic="emergency_alarm",
                description="Urgent request for the medical care",
            ),
        ]
    )
    evaluator = OffTopicEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score >= 0.75
    assert result.details == f"Detected intent: other"
    assert result.cost
    assert result.cost.amount > 0


def test_off_topic_evaluator_default():
    entry = OffTopicEntry(input="Hey there, how are you?")
    settings = OffTopicSettings()
    evaluator = OffTopicEvaluator(settings=settings)
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.score >= 0.75
    assert result.details == f"Detected intent: simple_chat"
    assert result.label == "simple_chat"
    assert result.cost
    assert result.cost.amount > 0


# def test_off_topic_evaluator_long():
#     entry = OffTopicEntry(input=long_text)
#     settings = OffTopicSettings(
#         max_tokens=10,
#         allowed_topics=[
#             AllowedTopic(
#                 topic="romantic_story",
#                 description="Beatiful description of man's life",
#             ),
#             AllowedTopic(
#                 topic="landscape_description",
#                 description="Beatiful description of a landscape",
#             ),
#             AllowedTopic(
#                 topic="emergency_alarm",
#                 description="Urgent request for the medical care",
#             ),
#         ],
#     )
#     evaluator = OffTopicEvaluator(settings=settings)
#     result = evaluator.evaluate(entry)

#     assert result.status == "processed"
#     assert result.label == "romantic_story"
#     assert result.details == f"Detected intent: landscape_description"


# def test_off_topic_evaluator_long_2():
#     entry = OffTopicEntry(input=long_text)
#     settings = OffTopicSettings(
#         max_tokens=200,
#         allowed_topics=[
#             AllowedTopic(
#                 topic="romantic_story",
#                 description="A romanticised description of someone's life",
#             ),
#             AllowedTopic(
#                 topic="landscape_description",
#                 description="Description of the landsacpe",
#             ),
#             AllowedTopic(
#                 topic="emergency_alarm",
#                 description="Urgent request for the medical care",
#             ),
#         ],
#     )
#     evaluator = OffTopicEvaluator(settings=settings)
#     result = evaluator.evaluate(entry)

#     assert result.status == "processed"
#     assert result.details == f"Detected intent: romantic_story"


long_text = (
    """As dawn broke over the horizon, the small coastal town of Marbell began to stir. The fishermen were the first to rise, setting out in their boats with the hope of a bountiful catch. The sea was calm, reflecting the pastel colors of the sky as the sun slowly climbed.

Meanwhile, in a completely different part of the world, Dr. Elena Mirov was preparing for a crucial experiment in her laboratory. Her work on quantum computing could potentially revolutionize the way we understand and interact with the digital world. Today, she was testing a new type of qubit that promised to be more stable than anything previously developed.

In a quiet suburb, an old man named Gerald sat on his porch, sipping coffee and watching the neighborhood children play. Gerald, a retired school teacher, found joy in these peaceful mornings, reminiscing about the days when he used to teach history to eager young minds.

On the financial front, the global markets were experiencing a surge due to unexpected stability in oil prices. Analysts on television and online were busy discussing the potential impacts on various economies, especially those heavily dependent on oil exports.

Somewhere in the dense jungles of South America, an undiscovered species of bird sang its morning song. This bird, with iridescent feathers that seemed to change color with the light, was unknown to science. Deep in the foliage, a team of biologists led by Dr. Anika Rajan was on the verge of this groundbreaking discovery.

Back in the realm of fiction, a new novel was taking shape under the pen of Samuel Thompson. His story, set in a dystopian future, explored the lives of people surviving in a world where water had become more valuable than gold. His characters, from brave young rebels to cunning villains, were all intricately woven into a plot of survival and ethics.

In the world of technology, a new smartphone was being launched. It boasted features that were said to be ahead of its time, including an AI assistant that could predict user needs before they even expressed them. Tech enthusiasts and skeptics alike were eagerly awaiting its release to see if it lived up to the hype.

As these stories unfolded across the globe, the day promised to be filled with progress, discovery, and the simple joys of everyday life. Each narrative, distinct and vibrant, contributed to the tapestry of human experience, showcasing the myriad ways in which our lives are interconnected, even when we are unaware of it."""
    * 1000
)
