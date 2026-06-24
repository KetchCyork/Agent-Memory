import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface SnapshotManifest {
  id: string;
  createdAt: string;
  label?: string;
  files: {
    workMemoryPath: string;
    graphPath: string;
    feedbackPath: string;
    workMemoryCopy: string;
    graphCopy: string;
    feedbackCopy: string;
  };
}

export class SnapshotStore {
  constructor(private snapshotsDir: string) {
    mkdirSync(snapshotsDir, { recursive: true });
  }

  async create(opts: {
    workMemoryPath: string;
    graphPath: string;
    feedbackPath: string;
    label?: string;
  }): Promise<SnapshotManifest> {
    const id = randomUUID();
    const dir = join(this.snapshotsDir, id);
    mkdirSync(dir, { recursive: true });

    const safeCopy = (src: string, dest: string) => {
      if (existsSync(src)) copyFileSync(src, dest);
      else writeFileSync(dest, "[]");
    };

    const wCopy = join(dir, "work-memory.json");
    const gCopy = join(dir, "graph.json");
    const fCopy = join(dir, "feedback.json");
    safeCopy(opts.workMemoryPath, wCopy);
    safeCopy(opts.graphPath, gCopy);
    safeCopy(opts.feedbackPath, fCopy);

    const manifest: SnapshotManifest = {
      id,
      createdAt: new Date().toISOString(),
      label: opts.label,
      files: {
        workMemoryPath: opts.workMemoryPath,
        graphPath: opts.graphPath,
        feedbackPath: opts.feedbackPath,
        workMemoryCopy: wCopy,
        graphCopy: gCopy,
        feedbackCopy: fCopy,
      },
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  list(): SnapshotManifest[] {
    const subdirs = readdirSync(this.snapshotsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(this.snapshotsDir, d.name, "manifest.json"))
      .filter((p) => existsSync(p))
      .map((p) => JSON.parse(readFileSync(p, "utf8")) as SnapshotManifest);
    return subdirs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): SnapshotManifest | undefined {
    const manifestPath = join(this.snapshotsDir, id, "manifest.json");
    if (!existsSync(manifestPath)) return undefined;
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  }

  async restore(id: string): Promise<void> {
    const manifest = this.get(id);
    if (!manifest) throw new Error(`Snapshot ${id} not found`);
    // Auto-snapshot current state before restoring
    await this.create({
      workMemoryPath: manifest.files.workMemoryPath,
      graphPath: manifest.files.graphPath,
      feedbackPath: manifest.files.feedbackPath,
      label: `pre-restore-${id.slice(0, 8)}`,
    });
    if (existsSync(manifest.files.workMemoryCopy))
      copyFileSync(manifest.files.workMemoryCopy, manifest.files.workMemoryPath);
    if (existsSync(manifest.files.graphCopy))
      copyFileSync(manifest.files.graphCopy, manifest.files.graphPath);
    if (existsSync(manifest.files.feedbackCopy))
      copyFileSync(manifest.files.feedbackCopy, manifest.files.feedbackPath);
  }

  delete(id: string): boolean {
    const dir = join(this.snapshotsDir, id);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }
}
