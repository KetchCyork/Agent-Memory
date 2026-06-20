/**
 * Retrieval Policies
 * ------------------
 * Named retrieval configurations that let agents pick a strategy for their
 * task context. Each policy controls k, metadata filter, recency boost, and
 * whether to preload entity wiki summaries alongside results.
 *
 * Built-in policies are read-only defaults. Custom policies are persisted in a
 * JSON file and can be added / updated / deleted at runtime.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { EntityType } from "./context-graph.js";
import type { RetrievalHit } from "./store.js";

export interface RetrievalPolicy {
  name: string;
  description?: string;
  /** Number of chunks to return. */
  k: number;
  /** Optional LanceDB SQL WHERE clause, e.g. "type = 'proposal'". */
  filter?: string;
  /** Re-rank results by blending RRF score with recency. */
  boostRecent: boolean;
  /** Weight of the recency component (0–1). 0.2 is a sensible default. */
  boostRecentFactor: number;
  /** Prepend entity wiki summaries for entities that match the query. */
  includeWiki: boolean;
  /** Entity types to include in wiki preload. All types if omitted. */
  wikiEntityTypes?: EntityType[];
}

// ---------------------------------------------------------------------------
// Built-in policies (read-only)

const BUILT_IN: Readonly<Record<string, RetrievalPolicy>> = {
  default: {
    name: "default",
    description: "General-purpose retrieval: hybrid RRF, no filter.",
    k: 8,
    boostRecent: false,
    boostRecentFactor: 0,
    includeWiki: false,
  },
  "proposal-drafting": {
    name: "proposal-drafting",
    description: "Proposal context: prioritise proposal documents, boost recent, preload wikis.",
    k: 12,
    filter: "type = 'proposal'",
    boostRecent: true,
    boostRecentFactor: 0.25,
    includeWiki: true,
    wikiEntityTypes: ["project", "person"],
  },
  research: {
    name: "research",
    description: "Research context: wider recall, boost recent, no wiki.",
    k: 15,
    boostRecent: true,
    boostRecentFactor: 0.15,
    includeWiki: false,
  },
  "email-context": {
    name: "email-context",
    description: "Email drafting: compact, boost recent, preload person wikis.",
    k: 6,
    boostRecent: true,
    boostRecentFactor: 0.2,
    includeWiki: true,
    wikiEntityTypes: ["person"],
  },
};

// ---------------------------------------------------------------------------

export class RetrievalPolicyStore {
  private custom: Record<string, RetrievalPolicy> = {};

  constructor(private filePath: string) {
    this.load();
  }

  get(name: string): RetrievalPolicy | undefined {
    return BUILT_IN[name] ?? this.custom[name];
  }

  list(): RetrievalPolicy[] {
    const builtIn = Object.values(BUILT_IN);
    const custom = Object.values(this.custom);
    return [...builtIn, ...custom];
  }

  /** Returns true if the name is a built-in (cannot be overwritten or deleted). */
  isBuiltIn(name: string): boolean {
    return name in BUILT_IN;
  }

  upsert(policy: RetrievalPolicy): RetrievalPolicy {
    if (this.isBuiltIn(policy.name)) {
      throw new Error(`Cannot overwrite built-in policy "${policy.name}"`);
    }
    this.custom[policy.name] = policy;
    this.save();
    return policy;
  }

  delete(name: string): boolean {
    if (this.isBuiltIn(name)) throw new Error(`Cannot delete built-in policy "${name}"`);
    if (!this.custom[name]) return false;
    delete this.custom[name];
    this.save();
    return true;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      this.custom = JSON.parse(raw);
    } catch {
      this.custom = {};
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.custom, null, 2), "utf8");
  }
}

// ---------------------------------------------------------------------------
// Recency boost

const RRF_NORMALISE_DAYS = 90;

/**
 * Blend each hit's RRF score with a recency component derived from chunk.updated.
 * Re-sorts results in descending score order.
 */
export function applyRecencyBoost(
  hits: RetrievalHit[],
  factor = 0.2
): RetrievalHit[] {
  if (!factor || !hits.length) return hits;
  const now = Date.now();
  const dayMs = 86_400_000;
  return hits
    .map((hit) => {
      const updatedMs = hit.chunk.updated ? new Date(hit.chunk.updated).getTime() : 0;
      const daysOld = Math.max(0, (now - updatedMs) / dayMs);
      const recency = Math.max(0, 1 - daysOld / RRF_NORMALISE_DAYS);
      return { ...hit, score: hit.score * (1 + factor * recency) };
    })
    .sort((a, b) => b.score - a.score);
}
