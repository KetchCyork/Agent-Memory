---
name: tsp-proposals
description: Draft, review, or restructure TSP client proposals, RFP responses, and Statements of Work in the firm's house style. Use whenever the work is a proposal, SOW, RFP response, or any client-facing engagement document — including reviewing a draft for tone, section order, or commercial framing.
---

# TSP proposals

The firm's proposal voice, structure, and drafting rules. Load the reference files below
rather than working from generic consulting-proposal conventions.

## Before drafting

1. **Check the platform question first.** Does the opportunity name a client-confirmed
   target platform, or is it selection-first/advisory? This changes the whole structure —
   see `reference/lessons.md`. Getting this wrong has already cost a draft.
2. **Read the right structure file, and follow its headings exactly.** For a SOW or
   implementation proposal that is `reference/sow-outline.md` — the six numbered section
   names are fixed, and the numbering runs three levels deep. For advisory work it is
   `reference/standard-proposal-template.md`. Then read `reference/proposal-style.md` for
   tone and stock phrasing.
3. **Check for a memory snapshot.** On Windows that is `C:\CoworkMemory\tsp-proposals\`; on
   macOS `~/CoworkMemory/tsp-proposals/`. If it exists, read `_index.md` and the topic
   files relevant to this piece — they carry real excerpts from past proposals and SOWs.
   If `_STALE.md` is present, flag it.

## Which structure to use

There are two, and they are not interchangeable.

**Advisory / consulting opportunities — use the board-defined template.** This is the
firm's default. Ten sections: Executive Summary, Understanding of Your Needs, Proposed
Approach & Methodology, Scope of Services, Timeline & Milestones, Team & Qualifications,
Investment, Assumptions & Exclusions, Why Us, Acceptance. Full detail and the required
facts to gather are in `reference/standard-proposal-template.md`.

**SAP implementation proposals and SOWs — use the six numbered sections below.** This is
the real structure of TSP's SOWs, taken from the documents themselves. Use these exact
headings and this exact numbering. Full outline and the numbering rules are in
`reference/sow-outline.md` — read it before drafting a SOW.

```
1   Statement of Work
2   Executive Summary
3   Project Scope
      3.1  Overall Project Scope
      3.2  L3 Functional Module Scope
      3.3  Out of Scope
      3.4  Assumptions
4   Overall Implementation Methodology
      4.1  SAP Activate Methodology
      4.2  Public Cloud Landscape Approach
5   Project Staffing, Fees, and Billing
      5.1  Project Staffing
      5.2  Project Phase Project Fees and Expenses
      5.3  Billing Schedule and Payment Terms
      5.4  Billing Information
      5.5  Taxes
6   Proposal Acceptance
```

Every client-facing document opens with an Executive Summary regardless of which structure
applies — that's a standing board rule. In a SOW it is section 2, after the Statement of
Work preamble.

## Heading numbering and Word styles

TSP SOWs use multi-level decimal numbering throughout, to three levels — `3`, `3.1`,
`3.1.1`. This is not decoration: the sections are cross-referenced by number, and a
document with unnumbered or differently-numbered headings reads as not ours.

When producing a Word document, map the levels onto Word's built-in heading styles so the
numbering, navigation pane and table of contents all work:

| Level | Word style | Example |
|---|---|---|
| Top-level section | Heading 1 | `3  Project Scope` |
| Subsection | Heading 2 | `3.1  Overall Project Scope` |
| Sub-subsection | Heading 3 | `3.1.1  Time and Materials Project Approach` |

Rules that are easy to get wrong:

- **Number every heading**, including level 3. Do not stop numbering partway down.
- **Use the built-in Heading 1/2/3 styles**, not bold body text that looks like a heading.
  A table of contents and the navigation pane both depend on real styles.
- **Do not renumber to close gaps.** The corpus contains sequences like `3.1.6` followed by
  `3.1.8`; sections get removed for a given client and the rest keep their numbers. If you
  are editing an existing SOW, leave the existing numbers alone.
- **Go three levels deep where the content needs it** — `3.4 Assumptions` routinely breaks
  into General, Training, Data Migration, Testing and Security assumptions as `3.4.x`.
- Numbering restarts at 1 in each document; there is no continuation across documents.

## Voice

- Formal to semi-formal, business-professional throughout.
- Third person for the firm ("Service Provider will…", "TSP…"); second person sparingly in
  client-facing narrative ("your installed base customers").
- Active voice in methodology sections; passive is acceptable in legal/contractual prose.
- SAP product names and acronyms used without explanation (S/4HANA, SAC, RISE, DDA, FPS,
  ABAP) — the reader is technically literate.
- Dense noun phrases in definitions; short bullet fragments in scope lists.

## Guardrails

- **Client confidentiality.** Past-proposal material teaches structure and phrasing. Never
  carry one client's names, pricing, scope specifics, or named personnel into another
  client's document.
- **Be explicit about scope exclusions.** Our SOWs list out-of-scope items even when
  they're implied — organizational change management, end-user training, infrastructure,
  licenses. Follow that habit.
- **Don't invent precedent.** If the reference files and snapshot don't support a claim
  about how the firm works, say so rather than filling the gap.

## Reference files

- `reference/sow-outline.md` — the real SOW / implementation outline with every recurring
  subsection and the numbering rules. **Read this before drafting a SOW or implementation
  proposal.**
- `reference/proposal-style.md` — the full TSP proposal style profile (tone, boilerplate).
- `reference/standard-proposal-template.md` — the board-defined advisory/consulting skeleton.
- `reference/lessons.md` — corrections from past drafts. Read before drafting.
