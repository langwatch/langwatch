import "dotenv/config";
import { weatherAgent } from "./agent.js";

async function main() {
  const response = await weatherAgent.generate(
    "What's the weather like in Amsterdam?"
  );
  console.log(response.text);
}

main().catch(console.error);
