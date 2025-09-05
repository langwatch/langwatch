import fs from "fs";
import path from "path";

// Make the built file executable
const indexPath = path.join("dist", "index.js");
if (fs.existsSync(indexPath)) {
  fs.chmodSync(indexPath, "755");
  console.log("Made index.js executable");
}
