/** Main test runner — imports all suites and runs them in order. */

import { runWorkMemoryTests } from "./work-memory.test.js";
import { runConsolidatorTests } from "./consolidator.test.js";
import { runContextGraphTests } from "./context-graph.test.js";
import { runRetrievalPolicyTests } from "./retrieval-policy.test.js";
import { runFeedbackTests } from "./feedback.test.js";
import { runMetricsTests } from "./metrics.test.js";
import { runSnapshotsTests } from "./snapshots.test.js";

async function main() {
  let exitCode = 0;
  const suites = [
    { name: "WorkMemory", fn: runWorkMemoryTests },
    { name: "Consolidator", fn: runConsolidatorTests },
    { name: "ContextGraph", fn: runContextGraphTests },
    { name: "RetrievalPolicy", fn: runRetrievalPolicyTests },
    { name: "Feedback", fn: runFeedbackTests },
    { name: "Metrics", fn: runMetricsTests },
    { name: "Snapshots", fn: runSnapshotsTests },
  ];

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
