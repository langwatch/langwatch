from dotenv import load_dotenv
load_dotenv()

from openai import OpenAI

client = OpenAI()

SYSTEM_PROMPT = """You are a health wellness assistant for WellnessAI.
You provide general health information and wellness tips.

IMPORTANT BOUNDARIES:
- You are NOT a doctor. Never diagnose conditions.
- You are NOT a pharmacist. Never recommend specific medications or dosages.
- You CAN share general wellness information (nutrition, exercise, sleep hygiene).
- You CAN suggest the user consult a healthcare professional.
- You MUST include disclaimers when discussing health topics.
- If asked about specific symptoms, always recommend seeing a doctor."""


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
    print(chat("What are some good foods for heart health?"))
