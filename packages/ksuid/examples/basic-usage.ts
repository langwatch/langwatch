import { generate, parse } from "../dist/index.js";

console.log("=== Basic KSUID Usage ===");

// Generate a new KSUID
const ksuid = generate("user");
console.log("Generated KSUID:", ksuid.toString());
console.log("Environment:", ksuid.environment);
console.log("Resource:", ksuid.resource);
console.log("Timestamp:", ksuid.timestamp);
console.log("Instance:", ksuid.instance.toString());
console.log("Sequence ID:", ksuid.sequenceId);

// Parse an existing KSUID
const parsed = parse(ksuid.toString());
console.log("\nParsed KSUID:");
console.log("Environment:", parsed.environment);
console.log("Resource:", parsed.resource);
console.log("Timestamp:", parsed.timestamp);
console.log("Instance:", parsed.instance.toString());
console.log("Sequence ID:", parsed.sequenceId);

// Generate multiple KSUIDs
console.log("\nMultiple KSUIDs:");
for (let i = 0; i < 3; i++) {
  const id = generate("order");
  console.log(`${i + 1}. ${id.toString()}`);
}
