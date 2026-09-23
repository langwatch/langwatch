import {
  Ksuid,
  Node,
  Instance,
  generate,
  parse,
  setEnvironment,
  getEnvironment,
  setInstance,
  getInstance,
} from "../dist/index.js";

console.log("=== Advanced KSUID Usage ===");

// Create a custom Node instance
const customNode = new Node(
  "dev",
  new Instance(Instance.schemes.RANDOM, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
  (environment, resource, timestamp, instance, sequenceId) => {
    return new Ksuid(environment, resource, timestamp, instance, sequenceId);
  },
);

// Generate KSUIDs with custom node
const customKsuid = customNode.generate("testresource");
console.log("Custom Node KSUID:", customKsuid.toString());
console.log("Custom Environment:", customKsuid.environment);

// Environment management
console.log("\n=== Environment Management ===");
console.log("Current environment:", getEnvironment());
setEnvironment("staging");
console.log("New environment:", getEnvironment());

// Generate KSUID in new environment
const stagingKsuid = generate("order");
console.log("Staging KSUID:", stagingKsuid.toString());

// Instance management
console.log("\n=== Instance Management ===");
const currentInstance = getInstance();
console.log("Current instance:", currentInstance.toString());

// Create a new instance with specific scheme
const newInstance = new Instance(
  Instance.schemes.DOCKER_CONT,
  new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
);
setInstance(newInstance);
console.log("New instance:", getInstance().toString());

// Generate KSUID with new instance
const newInstanceKsuid = generate("user");
console.log("New Instance KSUID:", newInstanceKsuid.toString());

// Parse and validate KSUIDs
console.log("\n=== Parsing and Validation ===");
const ksuidString = stagingKsuid.toString();
const parsedKsuid = parse(ksuidString);
console.log("Parsed KSUID:", parsedKsuid.toString());
console.log("Equals original:", parsedKsuid.equals(stagingKsuid));

// Access KSUID components
console.log("\n=== KSUID Components ===");
console.log("Environment:", parsedKsuid.environment);
console.log("Resource:", parsedKsuid.resource);
console.log("Timestamp:", parsedKsuid.timestamp);
console.log("Date:", parsedKsuid.date.toISOString());
console.log("Instance:", parsedKsuid.instance.toString());
console.log("Sequence ID:", parsedKsuid.sequenceId);

// Generate multiple KSUIDs for sorting demonstration
console.log("\n=== Sorting Demonstration ===");
const ksuids = [];
for (let i = 0; i < 5; i++) {
  ksuids.push(generate("item"));
}

// Sort by string representation (KSUIDs are naturally sortable)
const sorted = [...ksuids].toSorted((a, b) => {
  const left = a.toString();
  const right = b.toString();
  return left < right ? -1 : Number(left > right);
});
console.log("Sorted KSUIDs:");
sorted.forEach((ksuid, index) => {
  console.log(`${index + 1}. ${ksuid.toString()}`);
});
