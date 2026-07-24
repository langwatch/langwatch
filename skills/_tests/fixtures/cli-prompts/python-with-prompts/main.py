from dotenv import load_dotenv

load_dotenv()

from openai import OpenAI

client = OpenAI()

SYSTEM_PROMPT = "You are a friendly customer support agent. Help users with their questions about our product. Be empathetic and solution-oriented."


def chat(message: str) -> str:
    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": message},
        ],
    )
    return response.choices[0].message.content


if __name__ == "__main__":
    print(chat("How do I reset my password?"))
