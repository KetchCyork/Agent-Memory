/** Main test runner — imports all suites and runs them in order. */

import { runWorkMemoryTests } from "./work-memory.test.js";

async function main() {
  let exitCode = 0;
  const suites = [{ name: "WorkMemory", fn: runWorkMemoryTests }];

  for (const suite of suites) {
    try {
      await suite.fn();
    } catch (err: any) {
      console.error(`[FAIL] ${suite.name}: ${err.message}`);
      exitCode = 1;
    }
  }

  process.exit(exitCode);
}

main();
