import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type NodeStatus = "online" | "offline";

export interface MeshNode {
  id: string;
  name: string;
  /** Tailscale IP or hostname used to reach the node's mesh runner. */
  address: string;
  capabilities: string[];
  status: NodeStatus;
  registeredAt: string;
  lastHeartbeatAt: string;
  /** Arbitrary metadata (OS, runner version, etc.). */
  metadata?: Record<string, unknown>;
}

export interface NodeRegistration {
  name: string;
  address: string;
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

interface RegistryState {
  nodes: MeshNode[];
}

export class NodeRegistry {
  private state: RegistryState;

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      try {
        this.state = JSON.parse(readFileSync(filePath, "utf8"));
      } catch {
        this.state = { nodes: [] };
      }
    } else {
      this.state = { nodes: [] };
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Register a node. If a node with the same name already exists, updates it
   * in place (idempotent re-registration). Returns the node record.
   */
  register(input: NodeRegistration): MeshNode {
    const now = new Date().toISOString();
    const existing = this.state.nodes.find((n) => n.name === input.name);
    if (existing) {
      existing.address = input.address;
      existing.capabilities = input.capabilities;
      existing.status = "online";
      existing.lastHeartbeatAt = now;
      if (input.metadata) existing.metadata = input.metadata;
      this.save();
      return existing;
    }
    const node: MeshNode = {
      id: randomUUID(),
      name: input.name,
      address: input.address,
      capabilities: input.capabilities,
      status: "online",
      registeredAt: now,
      lastHeartbeatAt: now,
      metadata: input.metadata,
    };
    this.state.nodes.push(node);
    this.save();
    return node;
  }

  get(id: string): MeshNode | undefined {
    return this.state.nodes.find((n) => n.id === id);
  }

  getByName(name: string): MeshNode | undefined {
    return this.state.nodes.find((n) => n.name === name);
  }

  list(filter?: { status?: NodeStatus; capability?: string }): MeshNode[] {
    let nodes = [...this.state.nodes];
    if (filter?.status) nodes = nodes.filter((n) => n.status === filter.status);
    if (filter?.capability) nodes = nodes.filter((n) => n.capabilities.includes(filter.capability!));
    return nodes;
  }

  /** Update lastHeartbeatAt and set status to online. Returns false if node not found. */
  heartbeat(id: string): boolean {
    const node = this.state.nodes.find((n) => n.id === id);
    if (!node) return false;
    node.lastHeartbeatAt = new Date().toISOString();
    node.status = "online";
    this.save();
    return true;
  }

  /** Mark a node as offline. Returns false if node not found. */
  deregister(id: string): boolean {
    const node = this.state.nodes.find((n) => n.id === id);
    if (!node) return false;
    node.status = "offline";
    this.save();
    return true;
  }

  /** Hard-delete a node from the registry. Returns false if not found. */
  remove(id: string): boolean {
    const before = this.state.nodes.length;
    this.state.nodes = this.state.nodes.filter((n) => n.id !== id);
    if (this.state.nodes.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  /** Find nodes that advertise a given capability. */
  findByCapability(capability: string): MeshNode[] {
    return this.state.nodes.filter((n) => n.capabilities.includes(capability) && n.status === "online");
  }
}
