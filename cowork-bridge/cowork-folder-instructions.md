# Folder instructions — TSP proposal work

Paste this into Cowork's **folder instructions** for the folder you draft proposals in
(Cowork → select the folder → Folder instructions). It assumes the memory snapshot lives
at `C:\CoworkMemory\tsp-proposals\`.

---

## What's in `C:\CoworkMemory\tsp-proposals\`

A point-in-time snapshot of the firm's proposal memory, pulled from the Agent-Memory brain
on the MacBook over Tailscale. It is **not** a live query — nothing in Cowork can reach
that service directly.

- `_index.md` — always read this first. It carries the generation timestamp, which topics
  refreshed successfully, and the full list of source documents in the snapshot.
- `structure-and-sections.md`, `commercial-terms.md`, `methodology.md`,
  `roles-and-resourcing.md`, `legal-boilerplate.md`, `rfp-response-patterns.md`,
  `past-engagements.md` — retrieved excerpts grouped by source document.
- `_STALE.md` — **if this file exists, the last refresh failed.** Say so before relying on
  anything in the folder.
- `_status.json` — machine-readable run status.

## How to use it

1. Read `_index.md` before drafting anything client-facing. If the generated timestamp is
   more than a week old, tell me before you proceed.
2. Ground structure, phrasing, and commercial framing in these excerpts rather than
   generic consulting-proposal conventions.
3. Cite the source document path when you lift structure or language from it, so I can
   trace it back.
4. If the snapshot doesn't cover what you need, say so plainly. Do not invent firm
   precedent that isn't in the folder.

## Hard rules

**Client confidentiality.** The snapshot contains material from named client engagements.
Use it to learn *structure, tone, and commercial patterns*. Never copy one client's
specifics — names, pricing, scope language, personnel — into a proposal for a different
client. If you're unsure whether something is reusable boilerplate or client-specific,
ask me.

**Never presume a platform.** Our corpus is heavily SAP-weighted, and that has already
pulled one draft toward presuming S/4HANA before any selection had happened. Before
drafting, check whether the opportunity names a client-confirmed target platform or is
selection-first/advisory. If it's advisory, structure it as Phase 1 Selection
(vendor-neutral requirements, evaluation, recommendation) + Phase 2 Implementation, and
keep methodology and scope language vendor-neutral throughout.

**Snapshot, not truth.** These are retrieval excerpts, sometimes truncated mid-document.
Treat them as evidence of how we write, not as the authoritative contract text.
