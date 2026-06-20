/**
 * Vault loader
 * ------------
 * Reads markdown notes from the Obsidian vault, parses frontmatter, and splits
 * each note into overlapping chunks ready for embedding. The vault stays the
 * store of record; this just makes it indexable.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import matter from "gray-matter";

export interface NoteChunk {
  index: number;
  text: string;
}

export interface ParsedNote {
  notePath: string;                  // relative to vault root
  type: string;
  tags: string;                      // space-joined
  source: string;
  updated: string;                   // ISO
  chunks: NoteChunk[];
}

const CHUNK_CHARS = 1200;
const OVERLAP = 200;

/** Recursively list .md files under a directory. */
export async function listMarkdown(dir: string, root = dir): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try { entries = await readdir(dir); } catch { return out; }
  for (const name of entries) {
    if (name.startsWith(".")) continue; // skip .obsidian, etc.
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) out.push(...(await listMarkdown(full, root)));
    else if (extname(name).toLowerCase() === ".md") out.push(full);
  }
  return out;
}

export async function parseNote(absPath: string, vaultRoot: string): Promise<ParsedNote> {
  const raw = await readFile(absPath, "utf8");
  const fm = matter(raw);
  const data = fm.data ?? {};
  const st = await stat(absPath);

  const tags = Array.isArray(data.tags) ? data.tags.join(" ") : String(data.tags ?? "");
  return {
    notePath: relative(vaultRoot, absPath),
    type: String(data.type ?? "note"),
    tags,
    source: String(data.source ?? "manual"),
    updated: (data.updated ? new Date(String(data.updated)) : st.mtime).toISOString(),
    chunks: chunkText(fm.content.trim()),
  };
}

/** Split on character windows with overlap; preserves paragraph boundaries where easy. */
export function chunkText(text: string): NoteChunk[] {
  if (!text) return [];
  const chunks: NoteChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHARS, text.length);
    // Try to break on a paragraph/newline near the window edge.
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > start + CHUNK_CHARS / 2) end = nl;
    }
    chunks.push({ index: index++, text: text.slice(start, end).trim() });
    if (end >= text.length) break;
    start = end - OVERLAP;
  }
  return chunks.filter((c) => c.text.length > 0);
}
