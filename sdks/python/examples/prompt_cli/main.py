import langwatch
import dotenv

dotenv.load_dotenv()

langwatch.setup()

def main():
    prompt = langwatch.prompts.get("agent/performance")
    print(prompt.prompt)

if __name__ == "__main__":
    main()