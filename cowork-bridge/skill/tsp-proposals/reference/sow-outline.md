# TSP SOW / implementation proposal outline

Extracted from TSP's own Statements of Work and implementation proposals, not inferred.
Section names and numbers below are the ones the documents actually use.

Not every engagement uses every subsection. Drop what does not apply — but keep the
top-level six, keep the names, and keep the numbering scheme.

---

## 1  Statement of Work

The preamble that makes the document a SOW: parties, the governing MSA it attaches to,
effective date, and the defined terms the rest of the document leans on (Deliverables,
Documentation, Services, IP Rights).

Written in contractual register. Passive voice is acceptable and normal here.

## 2  Executive Summary

Three to five sentences: the client's situation, what TSP proposes, the outcome, and why
TSP. Opens every client-facing document — standing board rule.

Do not introduce scope detail here. It restates the client's own framing.

## 3  Project Scope

### 3.1  Overall Project Scope

The commercial and logistical frame. Recurring sub-subsections:

- `3.1.1` Time and Materials Project Approach — or Fixed Fee, matching section 5
- `3.1.2` Project Location
- `3.1.3` Geographic Scope
- `3.1.4` Project, Communication, and S/4HANA languages
- `3.1.5` SAP RICEFW Scope
- `3.1.6` Budget Hours for Development
- `3.1.8` Data Migration Scope
- `3.1.9` Post Go-Live Support

Note the gap at `3.1.7` — see "Numbering" below. That is how the corpus reads; it is not
a transcription error.

### 3.2  L3 Functional Module Scope

Scope by SAP functional area. The modules named depend on the engagement; recurring ones
include S/4HANA Digital Core, Situation Handling, and Joule AI, plus process-area
breakdowns such as Finance and Group Reporting, Procure-to-Pay (P2P), Order-to-Cash (OTC),
Manufacturing and Production, Inventory and Warehouse Management, and Integration
Landscape Evaluation.

### 3.3  Out of Scope

Explicit, itemised, and not optional. TSP SOWs list exclusions even when they are obvious.
Items that recur: organisational change management, end-user training (train-the-trainer
is usually in scope, the rest is not), infrastructure, networking, hardware, hosting, and
licences.

Must stay consistent with 3.1 and 3.2 — nothing listed as in scope may also appear here.

### 3.4  Assumptions

Broken out by area, typically:

- `3.4.1` General Assumptions
- `3.4.3` Training Assumptions
- `3.4.4` Data Migration Assumptions
- `3.4.5` Testing Assumptions
- `3.4.6` Security Assumptions

## 4  Overall Implementation Methodology

### 4.1  SAP Activate Methodology

The phase walk-through. Recurring sub-subsections, in this order:

- `4.1.1` Timeline
- `4.1.2` Motion AI
- `4.1.3` TSP Proprietary Accelerators
- `4.1.4` The Silicon Partners Quality Gate Process
- `4.1.5` Prepare Phase
- `4.1.6` Explore Phase
- `4.1.7` Realize Phase
- `4.1.8` Deploy Phase
- `4.1.9` Run Phase
- `4.1.10` Key Decisions and Communications

Active voice here. This is the section that differentiates TSP, so the accelerators and
Quality Gate process carry weight — do not reduce them to a sentence.

### 4.2  Public Cloud Landscape Approach

The system landscape, where relevant to the deployment model:

- `4.2.1` Starter System
- `4.2.2` Central Business Configuration (CBC)
- Parallel System, Customizing System (Coding Tenant), Parallel Customizing System,
  Quality System, Production System

Testing phases, where the engagement details them, follow the same pattern: Configuration
Validation Testing, System Integration Testing (SIT), Data Migration Validation Testing,
User Acceptance Testing (UAT), Cutover and Deployment Testing.

## 5  Project Staffing, Fees, and Billing

- `5.1` Project Staffing — named roles, not necessarily named individuals
- `5.2` Project Phase Project Fees and Expenses
- `5.3` Billing Schedule and Payment Terms
- `5.4` Billing Information
- `5.5` Taxes

Never invent numbers. Use board-supplied figures only, and mark anything outstanding as
`[TBD: pricing]`.

## 6  Proposal Acceptance

Signature block, authorised representatives, and the validity period of the proposal.

---

## Numbering

Three levels of decimal numbering, applied to every heading:

| Level | Word style | Example |
|---|---|---|
| Section | Heading 1 | `3  Project Scope` |
| Subsection | Heading 2 | `3.1  Overall Project Scope` |
| Sub-subsection | Heading 3 | `3.1.1  Time and Materials Project Approach` |

- Use Word's **built-in** Heading 1/2/3 styles. Bold body text that merely looks like a
  heading breaks the table of contents and the navigation pane.
- Number every heading, to all three levels. Do not stop partway.
- **Gaps are normal and must be preserved.** `3.1.6` → `3.1.8` and `3.2.1` → `3.2.3` both
  appear in live SOWs: a subsection was removed for that client and the rest kept their
  numbers, because the numbers are cross-referenced elsewhere in the document. When
  editing an existing SOW, never renumber to tidy up.
- Numbering restarts at 1 in each document.

## Where this differs from an advisory proposal

This outline is for SAP implementation work and SOWs. A selection-first or advisory
opportunity uses the board-defined ten-section template in
`standard-proposal-template.md` instead, and must stay vendor-neutral — see `lessons.md`.
Choosing the wrong one of these two is the most consequential structural mistake
available, so settle it before drafting.
