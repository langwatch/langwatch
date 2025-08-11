"""
Example demonstrating LangWatch prompt management operations.

This example shows how to:
1. Create a new prompt
2. Retrieve and use a prompt
3. Update a prompt
4. Use the updated prompt
5. Delete a prompt

Run this example with:
    python examples/prompt_management.py
"""

from dotenv import load_dotenv
import langwatch
import uuid

load_dotenv()


def main():
    # Initialize LangWatch (ensure you have LANGWATCH_API_KEY set)
    langwatch.setup(debug=True)

    print("=== LangWatch Prompt Management Example ===\n")

    # 1. Create a new prompt
    print("1. Creating a new prompt...")
    short_uuid = str(uuid.uuid4())[:8]
    prompt = langwatch.prompts.create(
        handle=f"example_prompt_{short_uuid}",
        scope="PROJECT",  # optional - 'ORGANIZATION' or 'PROJECT'
        author_id=None,  # optional
        prompt="You are a helpful assistant. Answer the user's question: {question}",  # optional
        messages=[  # optional
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "{question}"},
        ],
        inputs=[{"identifier": "question", "type": "string"}],  # optional
        outputs=[  # optional
            {"identifier": "answer", "type": "string", "json_schema": None}
        ],
    )
    print(f"Created prompt with ID: {prompt.id}")
    print(f"Prompt name: {prompt.name}\n")

    # 2. Get and use the prompt
    print("2. Retrieving the prompt...")
    retrieved_prompt = langwatch.prompts.get(prompt.id)
    print(f"Retrieved prompt: {retrieved_prompt.name}")
    print(f"Prompt ID: {retrieved_prompt.id}")

    # Use the prompt (example usage)
    print("Using the prompt...")
    # Note: Actual prompt usage would depend on your specific implementation
    # This is just demonstrating that we have the prompt object
    print(f"Prompt ready for use: {retrieved_prompt.name}\n")

    # 3. Update the prompt
    print("3. Updating the prompt...")
    updated_prompt = langwatch.prompts.update(
        prompt_id=prompt.id,
        handle=f"updated_example_prompt_{short_uuid}",  # optional
        scope="PROJECT",  # optional - 'ORGANIZATION' or 'PROJECT'
    )
    print(f"Updated prompt name: {updated_prompt.name}")
    print(f"Prompt ID remains: {updated_prompt.id}")

    # 4. Use the updated prompt
    print("Using the updated prompt...")
    print(f"Updated prompt ready for use: {updated_prompt.name}\n")

    # 5. Delete the prompt
    print("5. Deleting the prompt...")
    result = langwatch.prompts.delete(prompt.id)
    print(f"Deletion result: {result}")
    print("Prompt management example completed successfully!")


if __name__ == "__main__":
    main()
