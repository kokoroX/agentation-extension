import { copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const srcDir = join(root, "sidecar");
const targetDir = join(homedir(), ".gemini", "config", "sidecars", "agentation-bridge");

mkdirSync(targetDir, { recursive: true });
copyFileSync(join(srcDir, "sidecar.json"), join(targetDir, "sidecar.json"));
copyFileSync(join(srcDir, "server.mjs"), join(targetDir, "server.mjs"));

console.log(`Installed agentation-bridge sidecar to ${targetDir}`);
