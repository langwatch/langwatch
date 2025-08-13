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
        handle=f"something/example_prompt_{short_uuid}",
        scope="PROJECT",  # optional - 'ORGANIZATION' or 'PROJECT'
        author_id=None,  # optional
        prompt="You are a helpful assistant. Answer the user's question: {question}",  # optional
        messages=[  # optional
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "{question}"},
        ],
        inputs=[{"identifier": "question", "type": "str"}],  # optional
        outputs=[{"identifier": "answer", "type": "str"}],  # optional
    )
    print(f"Created prompt with id: {prompt.id}")
    print(f"Created prompt with handle: {prompt.handle}")

    # 2. Get and use the prompt
    print("2. Retrieving the prompt...")
    retrieved_prompt = langwatch.prompts.get(prompt.handle)
    print(f"Retrieved prompt: {retrieved_prompt.handle}")

    # Use the prompt (example usage)
    print("Using the prompt...")

    # Compile the prompt with variables
    compiled_prompt = retrieved_prompt.compile(
        question="What is the capital of France?"
    )
    print(f"Compiled prompt: {compiled_prompt}")

    # 3. Update the prompt
    print("3. Updating the prompt...")
    updated_prompt = langwatch.prompts.update(
        prompt.handle,
        handle=f"updated_example_prompt_{short_uuid}",  # optional
        scope="PROJECT",  # optional - 'ORGANIZATION' or 'PROJECT'
        prompt="You are a helpful assistant specializing in {subject}.",  # optional
    )
    print(f"Updated prompt name: {updated_prompt.name}")
    print(f"Prompt ID remains: {updated_prompt.id}")

    # 4. Use the updated prompt
    print("Using the updated prompt...")

    # Compile the updated prompt to show the difference
    updated_compiled = updated_prompt.compile(subject="quantum computing")
    print(f"Updated compiled prompt: {updated_compiled}")

    # This is where you would use the prompt in your application
    # For example, you could use the prompt to generate a response
    # response = langwatch.chat.completions.create(
    #     model="gpt-4o-mini",
    #     messages=[{"role": "user", "content": "What is the capital of France?"}],
    # )
    # print(f"Response: {response}")

    # 5. Delete the prompt
    print("5. Deleting the prompt...")
    result = langwatch.prompts.delete(updated_prompt.handle)
    print(f"Deletion result: {result}")
    print("Prompt management example completed successfully!")


if __name__ == "__main__":
    main()
