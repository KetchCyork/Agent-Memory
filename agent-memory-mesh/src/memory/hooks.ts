import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type HookEvent = "search" | "reindex" | "work-memory" | "consolidation" | "feedback";
export type HookAction = "log";

export interface HookCondition {
  /** Fire only when the operation took at least this many ms (search/reindex). */
  minLatencyMs?: number;
  /** Fire only when the operation encountered an error. */
  onError?: boolean;
  /** Fire only when any string field in the payload matches this regex. */
  pattern?: string;
}

export interface HookRule {
  id: string;
  name: string;
  event: HookEvent;
  condition?: HookCondition;
  action: HookAction;
  enabled: boolean;
  createdAt: string;
}

export interface HookFire {
  id: string;
  ruleId: string;
  ruleName: string;
  event: HookEvent;
  payload: Record<string, unknown>;
  firedAt: string;
}

interface HooksState {
  rules: HookRule[];
  history: HookFire[];
}

export class HooksEngine {
  private state: HooksState;

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      try {
        this.state = JSON.parse(readFileSync(filePath, "utf8"));
      } catch {
        this.state = { rules: [], history: [] };
      }
    } else {
      this.state = { rules: [], history: [] };
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  addRule(input: Omit<HookRule, "id" | "createdAt">): HookRule {
    const rule: HookRule = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.state.rules.push(rule);
    this.save();
    return rule;
  }

  getRule(id: string): HookRule | undefined {
    return this.state.rules.find((r) => r.id === id);
  }

  listRules(): HookRule[] {
    return [...this.state.rules];
  }

  updateRule(id: string, patch: Partial<Omit<HookRule, "id" | "createdAt">>): HookRule | undefined {
    const idx = this.state.rules.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    this.state.rules[idx] = { ...this.state.rules[idx], ...patch };
    this.save();
    return this.state.rules[idx];
  }

  removeRule(id: string): boolean {
    const before = this.state.rules.length;
    this.state.rules = this.state.rules.filter((r) => r.id !== id);
    if (this.state.rules.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listHistory(ruleId?: string): HookFire[] {
    return ruleId ? this.state.history.filter((h) => h.ruleId === ruleId) : [...this.state.history];
  }

  /**
   * Fire all enabled rules matching the given event. Evaluates conditions and
   * dispatches the configured action. Returns fires that were triggered.
   */
  fire(event: HookEvent, payload: Record<string, unknown>): HookFire[] {
    const fired: HookFire[] = [];
    for (const rule of this.state.rules) {
      if (!rule.enabled || rule.event !== event) continue;
      if (!this.matchesCondition(rule.condition, payload)) continue;

      const hookFire: HookFire = {
        id: randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        event,
        payload,
        firedAt: new Date().toISOString(),
      };
      this.dispatch(rule, hookFire);
      fired.push(hookFire);
      // Keep only last 200 history entries to bound file size
      this.state.history.push(hookFire);
      if (this.state.history.length > 200) this.state.history.shift();
    }
    if (fired.length) this.save();
    return fired;
  }

  private matchesCondition(cond: HookCondition | undefined, payload: Record<string, unknown>): boolean {
    if (!cond) return true;
    if (cond.onError && !payload.error) return false;
    if (cond.minLatencyMs !== undefined) {
      const lat = typeof payload.latencyMs === "number" ? payload.latencyMs : 0;
      if (lat < cond.minLatencyMs) return false;
    }
    if (cond.pattern) {
      const re = new RegExp(cond.pattern, "i");
      const haystack = JSON.stringify(payload);
      if (!re.test(haystack)) return false;
    }
    return true;
  }

  private dispatch(rule: HookRule, fire: HookFire): void {
    // Currently only "log" action is supported — future actions (webhook, etc.) extend here.
    if (rule.action === "log") {
      console.error(`[hook] ${rule.name} fired on ${fire.event}: ${JSON.stringify(fire.payload)}`);
    }
  }
}
