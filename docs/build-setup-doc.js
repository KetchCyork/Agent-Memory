const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, PageBreak, TableOfContents, PageOrientation,
} = require("docx");
const fs = require("fs");

// US Letter in DXA (1440 = 1 inch)
const LETTER = { width: 12240, height: 15840 };
const CONTENT_W = 12240 - 1440 - 1440; // 1" margins both sides = 9360

const INK = "1A1A1A";
const MUTED = "5A5A5A";
const ACCENT = "1F4E79";
const CODE_BG = "F4F4F4";
const WARN_BG = "FFF4E5";
const NOTE_BG = "EAF1F8";

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, bold: true, size: 32, color: ACCENT, font: "Calibri" })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26, color: INK, font: "Calibri" })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 100 },
    children: [new TextRun({ text, bold: true, size: 23, color: ACCENT, font: "Calibri" })],
  });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, line: 276 },
    children: [new TextRun({ text, size: 21, color: opts.color ?? INK, font: "Calibri", italics: !!opts.italics, bold: !!opts.bold })],
  });
}
/** Paragraph from mixed runs: ["plain", ["bold text","b"], ["code","c"]] */
function rich(parts, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, line: 276 },
    children: parts.map((x) => {
      if (typeof x === "string") return new TextRun({ text: x, size: 21, color: INK, font: "Calibri" });
      const [t, kind] = x;
      if (kind === "b") return new TextRun({ text: t, size: 21, color: INK, font: "Calibri", bold: true });
      if (kind === "i") return new TextRun({ text: t, size: 21, color: INK, font: "Calibri", italics: true });
      if (kind === "c") return new TextRun({ text: t, size: 19, color: "A03030", font: "Consolas" });
      return new TextRun({ text: t, size: 21, color: INK, font: "Calibri" });
    }),
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, size: 21, color: INK, font: "Calibri" })],
  });
}
function richBullet(parts, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 80, line: 276 },
    children: parts.map((x) => {
      if (typeof x === "string") return new TextRun({ text: x, size: 21, color: INK, font: "Calibri" });
      const [t, kind] = x;
      if (kind === "b") return new TextRun({ text: t, size: 21, color: INK, font: "Calibri", bold: true });
      if (kind === "c") return new TextRun({ text: t, size: 19, color: "A03030", font: "Consolas" });
      return new TextRun({ text: t, size: 21, color: INK, font: "Calibri", italics: true });
    }),
  });
}
function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "steps", level },
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, size: 21, color: INK, font: "Calibri" })],
  });
}
/** Monospace block, one Paragraph per line, shaded. */
function code(lines) {
  const arr = Array.isArray(lines) ? lines : [lines];
  return arr.map((line, i) =>
    new Paragraph({
      spacing: { before: i === 0 ? 100 : 0, after: i === arr.length - 1 ? 140 : 0, line: 240 },
      shading: { type: ShadingType.CLEAR, fill: CODE_BG },
      indent: { left: 200, right: 200 },
      children: [new TextRun({ text: line || " ", size: 18, font: "Consolas", color: "202020" })],
    })
  );
}
/** Callout box: a single-cell shaded table so it reads as a panel. */
function callout(title, bodyLines, fill = NOTE_BG) {
  const kids = [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: title, bold: true, size: 21, color: INK, font: "Calibri" })],
    }),
    ...bodyLines.map((t, i) =>
      new Paragraph({
        spacing: { after: i === bodyLines.length - 1 ? 0 : 80, line: 276 },
        children: [new TextRun({ text: t, size: 20, color: INK, font: "Calibri" })],
      })
    ),
  ];
  return new Table({
    columnWidths: [CONTENT_W],
    width: { size: CONTENT_W, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_W, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill },
            margins: { top: 160, bottom: 160, left: 200, right: 200 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 2, color: "D8D8D8" },
              bottom: { style: BorderStyle.SINGLE, size: 2, color: "D8D8D8" },
              left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT },
              right: { style: BorderStyle.SINGLE, size: 2, color: "D8D8D8" },
            },
            children: kids,
          }),
        ],
      }),
    ],
  });
}
function table(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(CONTENT_W / headers.length));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum !== CONTENT_W) w[w.length - 1] += CONTENT_W - sum;
  const cell = (text, i, isHead) =>
    new TableCell({
      width: { size: w[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: isHead ? ACCENT : "FFFFFF" },
      margins: { top: 90, bottom: 90, left: 130, right: 130 },
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text,
              bold: isHead,
              size: isHead ? 19 : 19,
              color: isHead ? "FFFFFF" : INK,
              font: text.match(/^[a-z0-9_.\-\\/$:~%]+$/i) && !isHead ? "Consolas" : "Calibri",
            }),
          ],
        }),
      ],
    });
  return new Table({
    columnWidths: w,
    width: { size: CONTENT_W, type: WidthType.DXA },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) })),
    ],
  });
}
function spacer(h = 140) {
  return new Paragraph({ spacing: { after: h }, children: [new TextRun({ text: "" })] });
}
function rule() {
  return new Paragraph({
    spacing: { before: 160, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D0D0D0" } },
    children: [new TextRun({ text: "" })],
  });
}

const children = [];

// ----------------------------------------------------------------- cover
children.push(
  new Paragraph({ spacing: { before: 2600, after: 0 }, children: [new TextRun({ text: "TSP", bold: true, size: 30, color: ACCENT, font: "Calibri" })] }),
  new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: "Build Your Own Proposal Memory", bold: true, size: 56, color: INK, font: "Calibri" })],
  }),
  new Paragraph({
    spacing: { after: 320 },
    children: [new TextRun({ text: "A local, private AI memory of the TSP proposal corpus — and a Claude skill that drafts in the firm's voice", size: 24, color: MUTED, font: "Calibri" })],
  }),
  new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: "Step-by-step setup for Windows and macOS", size: 22, color: INK, font: "Calibri", bold: true })],
  }),
  new Paragraph({
    spacing: { after: 600 },
    children: [new TextRun({ text: "Everything runs on your own machine. Nothing is sent to a shared server, and no client material leaves your laptop.", size: 21, color: MUTED, font: "Calibri", italics: true })],
  }),
  callout("A note on the command blocks", [
    "Where a block spans several lines, run them one line at a time. Pasting a multi-line command into PowerShell often leaves it waiting for input at a >> prompt, which looks like the command has hung.",
    "If that happens, press Ctrl+C and run the lines individually.",
  ]),
  spacer(100),
  callout("Before you start", [
    "Allow about 30 minutes of setup, then 1–2 hours of unattended indexing the first time.",
    "You need roughly 15 GB of free disk space and the TSP SharePoint library synced to your machine.",
    "If your laptop is locked down, you may need IT approval to install Ollama. Section 2 covers that.",
  ]),
  new Paragraph({ children: [new PageBreak()] })
);

// ------------------------------------------------------------------ TOC
children.push(
  h1("Contents"),
  new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({ children: [new PageBreak()] })
);

// --------------------------------------------------------------- overview
children.push(
  h1("1. What you are building"),
  p("Three pieces that work together on your own laptop."),
  spacer(60),
  table(
    ["Piece", "What it does"],
    [
      ["The memory brain", "Reads the TSP proposal corpus from your synced SharePoint folder, converts each document into searchable form, and answers questions about it. Runs locally on your machine."],
      ["A refresh job", "Re-reads the SharePoint folder on a schedule so new and changed proposals appear in memory without you doing anything."],
      ["The Claude skill", "Teaches Claude TSP's proposal structure, voice and drafting rules, and points it at a folder of real proposal excerpts drawn from the memory."],
    ],
    [2400, 6960]
  ),
  spacer(),
  p("Once set up, you open Claude, ask for a proposal, and it drafts using TSP's actual section order, commercial language and precedent — rather than generic consulting boilerplate."),
  h2("Why it runs locally"),
  p("Claude's custom connectors reach out from Anthropic's cloud, not from your laptop. They cannot see a service running on your own machine, and they cannot see your corporate network. So instead of connecting Claude directly to the memory, the refresh job writes a folder of plain Markdown files that Claude reads as local files. That is the seam that works, and it keeps every document on your machine."),
  callout("What this means for confidentiality", [
    "The proposal corpus is indexed on your laptop and stays there. The index is not shared with other colleagues, not uploaded anywhere, and not visible to anyone else.",
    "Claude does see the excerpts in the snapshot folder when you ask it to draft. That is the point — but it means the cross-client rule in Section 7 matters.",
  ], WARN_BG),
  rule()
);

// ---------------------------------------------------- prerequisites
children.push(
  h1("2. Prerequisites"),
  p("Install these before anything else. Both platforms need the same three tools."),
  spacer(60),
  table(
    ["Tool", "Why", "Check it worked"],
    [
      ["Node.js 18 or newer", "Runs the memory brain and the indexer", "node --version"],
      ["Ollama", "Converts documents into searchable form, locally and for free", "ollama --version"],
      ["Git", "Downloads the two code repositories", "git --version"],
    ],
    [2600, 4100, 2660]
  ),
  spacer(),
  h2("Windows"),
  p("Install from the official sites, or use winget from PowerShell if your machine allows it:"),
  ...code([
    "winget install OpenJS.NodeJS.LTS",
    "winget install Ollama.Ollama",
    "winget install Git.Git",
  ]),
  p("Then close and reopen PowerShell so the new commands are on your PATH, and confirm all three:"),
  ...code(["node --version", "ollama --version", "git --version"]),
  h2("macOS"),
  p("With Homebrew:"),
  ...code(["brew install node ollama git", "brew services start ollama"]),
  p("Without Homebrew, download Node from nodejs.org and Ollama from ollama.com, then install Git with:"),
  ...code(["xcode-select --install"]),
  h2("Download the embedding model"),
  p("This is what turns documents into something searchable. It is a one-off 274 MB download and runs entirely on your machine."),
  ...code(["ollama pull nomic-embed-text"]),
  callout("If Ollama is blocked by IT", [
    "Ollama is a local application with no cloud component — it does not send your documents anywhere. That is usually the reassurance IT needs.",
    "If you cannot get approval, stop here and talk to Chris. There are alternatives, but they involve sending document text to a cloud service, which is a different conversation about client confidentiality.",
  ], WARN_BG),
  h2("Find your SharePoint folder"),
  p("You need the local path to the synced TSP proposal library. Open it in File Explorer or Finder first and confirm you can see the client folders — if the files only exist online, the indexer cannot read them."),
  rich([["Windows", "b"], " — typically a mapped drive or a path under your user folder. Chris's is:"]),
  ...code(["D:\\The Silicon Partners Inc\\TSP SAP Delivery - Documents\\TSP Delivery\\02- Sales Activities and Collateral"]),
  rich([["macOS", "b"], " — synced SharePoint libraries live under CloudStorage. List yours with:"]),
  ...code(["ls ~/Library/CloudStorage/"]),
  p("Write your path down. You will need it twice."),
  callout("Files On-Demand", [
    "If your SharePoint files show as cloud icons rather than real files, the indexer will read placeholders and extract nothing.",
    "Right-click the proposal folder and choose \"Always keep on this device\" before indexing, then let it finish syncing. This is the single most common reason a first run produces nothing.",
  ], WARN_BG),
  rule()
);

// ------------------------------------------------------- install brain
children.push(
  new Paragraph({ children: [new PageBreak()] }),
  h1("3. Set up the memory brain"),
  p("Pick a folder to keep the code in. These instructions use a folder called TSP-Memory in your user directory; adjust if you prefer somewhere else."),
  h2("Step 1 — Download the code"),
  rich([["Windows", "b"]]),
  ...code([
    "mkdir $env:USERPROFILE\\TSP-Memory",
    "cd $env:USERPROFILE\\TSP-Memory",
    "git clone https://github.com/KetchCyork/Agent-Memory.git",
    "git clone https://github.com/KetchCyork/Agent-proposal-ingestion.git",
  ]),
  rich([["macOS", "b"]]),
  ...code([
    "mkdir -p ~/TSP-Memory",
    "cd ~/TSP-Memory",
    "git clone https://github.com/KetchCyork/Agent-Memory.git",
    "git clone https://github.com/KetchCyork/Agent-proposal-ingestion.git",
  ]),
  h2("Step 2 — Install the brain's dependencies"),
  rich([["Windows", "b"]]),
  ...code(["cd $env:USERPROFILE\\TSP-Memory\\Agent-Memory\\agent-memory-mesh", "npm install"]),
  rich([["macOS", "b"]]),
  ...code(["cd ~/TSP-Memory/Agent-Memory/agent-memory-mesh", "npm install"]),
  p("Warnings about deprecated packages are normal and can be ignored. An error is not — see Section 8 if one appears."),
  h2("Step 3 — Create your settings file"),
  p("The brain reads its settings from a file called .env. Create it from the supplied example, then fill in two values: a folder for the brain's own notes, and a password of your own choosing."),
  rich([["Windows", "b"]]),
  ...code([
    "Copy-Item .env.example .env",
    "mkdir $env:USERPROFILE\\TSP-Memory\\vault",
    "notepad .env",
  ]),
  rich([["macOS", "b"]]),
  ...code([
    "cp .env.example .env",
    "mkdir -p ~/TSP-Memory/vault",
    "open -e .env",
  ]),
  p("Set these five lines. Leave everything else as it is."),
  spacer(60),
  table(
    ["Setting", "Value"],
    [
      ["VAULT_PATH", "The vault folder you just created, full path"],
      ["MEMORY_HOST", "127.0.0.1  — keeps the brain private to your machine"],
      ["MEMORY_PORT", "8377"],
      ["MEMORY_API_KEY", "A long random string you invent. See below."],
      ["MEMORY_DB_PATH", "Leave blank — it defaults sensibly"],
    ],
    [2900, 6460]
  ),
  spacer(),
  p("Generate a password rather than typing one:"),
  rich([["Windows", "b"], " — run this and paste the result after ", ["MEMORY_API_KEY=", "c"]]),
  ...code([
    "$b = New-Object byte[] 24",
    "[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)",
    "-join ($b | ForEach-Object { $_.ToString('x2') })",
  ]),
  rich([["macOS", "b"]]),
  ...code(["openssl rand -hex 24"]),
  callout("Use your own key, not Chris's", [
    "This key only protects your own local brain. Invent a fresh one — there is no benefit to sharing, and a key that circulates between colleagues is a key nobody can change.",
    "Keep the .env file to yourself. It is excluded from Git, so it will not be uploaded by accident.",
  ]),
  h2("Step 4 — Start the brain and leave it running"),
  rich([["Windows", "b"]]),
  ...code(["npm run serve"]),
  rich([["macOS", "b"]]),
  ...code(["npm run serve"]),
  p("You should see a line confirming it is listening on 127.0.0.1:8377. Leave this window open — the brain needs to be running whenever you index documents or refresh the snapshot. Section 6 covers starting it automatically at login."),
  p("In a second window, confirm it answers:"),
  rich([["Windows", "b"]]),
  ...code(["Invoke-RestMethod http://127.0.0.1:8377/health"]),
  rich([["macOS", "b"]]),
  ...code(["curl http://127.0.0.1:8377/health"]),
  rich(["Either should return ", ["{\"ok\":true,\"service\":\"agent-memory-mesh\"}", "c"], "."]),
  rule()
);

// ----------------------------------------------------------- ingest
children.push(
  new Paragraph({ children: [new PageBreak()] }),
  h1("4. Index the proposal corpus"),
  p("This is the step that reads your SharePoint folder and builds the memory. It is also the slow one — around an hour for the full TSP corpus of roughly 3,400 documents. You only do it in full once."),
  h2("Step 1 — Configure the indexer"),
  rich([["Windows", "b"]]),
  ...code([
    "cd $env:USERPROFILE\\TSP-Memory\\Agent-proposal-ingestion",
    "npm install",
    "Copy-Item .env.example .env",
    "notepad .env",
  ]),
  rich([["macOS", "b"]]),
  ...code([
    "cd ~/TSP-Memory/Agent-proposal-ingestion",
    "npm install",
    "cp .env.example .env",
    "open -e .env",
  ]),
  p("Set two lines:"),
  spacer(60),
  table(
    ["Setting", "Value"],
    [
      ["MEMORY_URL", "http://127.0.0.1:8377"],
      ["MEMORY_API_KEY", "The same key you put in the brain's .env — they must match exactly"],
    ],
    [2900, 6460]
  ),
  spacer(),
  p("A mismatch here is the most common setup mistake. The indexer will appear to run and then fail on every single document."),
  h2("Step 2 — Index everything"),
  p("Substitute your own SharePoint path. Keep the quotes — the path contains spaces."),
  rich([["Windows", "b"]]),
  ...code([
    "npm run ingest-remote -- \"D:\\The Silicon Partners Inc\\TSP SAP Delivery - Documents\\TSP Delivery\\02- Sales Activities and Collateral\" --type proposal",
  ]),
  rich([["macOS", "b"]]),
  ...code([
    "npm run ingest-remote -- \"$HOME/Library/CloudStorage/<your-sharepoint-folder>/02- Sales Activities and Collateral\" --type proposal",
  ]),
  p("It prints one line per document as it goes. Leave the laptop on and awake; closing the window stops it. The last line tells you what happened:"),
  ...code(["Done. 3264 files ingested, 118122 chunks stored. 124 skipped."]),
  p("A few hundred skipped files is normal — empty documents, scanned PDFs with no text layer, and files that were open in Word at the time."),
  callout("What is being read", [
    "Word documents, PowerPoint decks and PDFs. Decks include speaker notes, which in proposal decks often carry the real argument.",
    "Excel models, videos and images are ignored.",
  ]),
  h2("Step 3 — Confirm it worked"),
  p("Ask the memory a question. If this returns results, you are done with the hard part."),
  rich([["Windows", "b"]]),
  ...code([
    "$k = (Get-Content .env | Select-String '^MEMORY_API_KEY=').ToString().Split('=')[1]",
    "Invoke-RestMethod -Uri http://127.0.0.1:8377/search -Method Post `",
    "  -Headers @{ 'X-Api-Key' = $k } -ContentType 'application/json' `",
    "  -Body '{\"query\":\"proposal fee structure\",\"k\":3}' |",
    "  Select-Object -ExpandProperty hits | ForEach-Object { $_.chunk.notePath }",
  ]),
  rich([["macOS", "b"]]),
  ...code([
    "K=$(grep '^MEMORY_API_KEY=' .env | cut -d= -f2-)",
    "curl -s -X POST http://127.0.0.1:8377/search \\",
    "  -H \"X-Api-Key: $K\" -H 'Content-Type: application/json' \\",
    "  -d '{\"query\":\"proposal fee structure\",\"k\":3}'",
  ]),
  p("You should see paths to real TSP proposals. If you get an authorisation error, the two .env keys do not match."),
  rule()
);

// ------------------------------------------------- keeping it current
children.push(
  new Paragraph({ children: [new PageBreak()] }),
  h1("5. Keep it current automatically"),
  p("SharePoint grows every week. A memory that reflects last month is worse than useless for drafting, because it looks current and is not."),
  p("After the first full index, the indexer can run in incremental mode: it remembers what it has already read and only processes documents that are new or changed. That takes seconds rather than an hour, which is what makes a daily refresh practical."),
  rich(["Add ", ["--changed-only", "c"], " to the same command you ran in Section 4:"]),
  ...code(["npm run ingest-remote -- \"<your SharePoint path>\" --type proposal --changed-only"]),
  p("Try it once by hand. It should report that nothing changed, or pick up just the handful of documents edited since your full index."),
  h2("Windows — schedule it daily"),
  p("Create a small script, then a scheduled task that runs it each morning."),
  rich(["First the script. Open Notepad, paste the two lines below — substituting your own two paths — and save it as ", ["TSP-Memory\\refresh-memory.ps1", "c"], " in your user folder. Use \"All Files\" as the file type so Notepad does not append .txt."]),
  ...code([
    "cd \"C:\\Users\\YOUR-NAME\\TSP-Memory\\Agent-proposal-ingestion\"",
    "npm run ingest-remote -- \"<your SharePoint path>\" --type proposal --changed-only",
  ]),
  p("Test it by running it directly before scheduling anything. If it does not work by hand, it will not work on a timer:"),
  ...code(["& \"$env:USERPROFILE\\TSP-Memory\\refresh-memory.ps1\""]),
  p("Then register it:"),
  ...code([
    "$action = New-ScheduledTaskAction -Execute 'powershell.exe' `",
    "  -Argument \"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `\"$env:USERPROFILE\\TSP-Memory\\refresh-memory.ps1`\"\"",
    "$trigger = New-ScheduledTaskTrigger -Daily -At '07:30'",
    "$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable",
    "Register-ScheduledTask -TaskName 'TSP Proposal Memory' -Action $action `",
    "  -Trigger $trigger -Settings $settings -User $env:USERNAME -RunLevel Limited -Force",
  ]),
  p("Confirm it registered, rather than trusting the message:"),
  ...code(["Get-ScheduledTask -TaskName 'TSP Proposal Memory'"]),
  callout("If you get \"Access is denied\"", [
    "Some managed laptops block task creation for standard users. Try again from a PowerShell window opened with \"Run as administrator\".",
    "If that also fails, skip the schedule and run the --changed-only command yourself when you know new proposals have landed. It takes seconds.",
  ], WARN_BG),
  h2("macOS — schedule it daily"),
  p("Create a launch agent. Replace both paths with your own, then load it:"),
  ...code([
    "cat > ~/Library/LaunchAgents/com.tsp.proposal-memory.plist <<'EOF'",
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<plist version=\"1.0\"><dict>",
    "  <key>Label</key><string>com.tsp.proposal-memory</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    "    <string>/bin/bash</string><string>-lc</string>",
    "    <string>cd ~/TSP-Memory/Agent-proposal-ingestion && npm run ingest-remote -- \"<your SharePoint path>\" --type proposal --changed-only</string>",
    "  </array>",
    "  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>",
    "  <key>StandardOutPath</key><string>/tmp/tsp-memory-refresh.log</string>",
    "  <key>StandardErrorPath</key><string>/tmp/tsp-memory-refresh.log</string>",
    "</dict></plist>",
    "EOF",
    "launchctl load ~/Library/LaunchAgents/com.tsp.proposal-memory.plist",
  ]),
  h2("Run a full index occasionally"),
  p("Incremental mode detects changes by file timestamp and size. That is reliable in practice, but a full run every month or so re-establishes a clean baseline and catches anything missed. Just drop the --changed-only flag."),
  rule()
);

// ----------------------------------------------- autostart the brain
children.push(
  h1("6. Start the brain automatically"),
  p("The brain must be running for the refresh job and for Claude's snapshot to work. Rather than remembering to start it, have it start when you log in."),
  h2("Windows"),
  ...code([
    "$action = New-ScheduledTaskAction -Execute 'powershell.exe' `",
    "  -Argument \"-NoProfile -WindowStyle Hidden -Command `\"cd '$env:USERPROFILE\\TSP-Memory\\Agent-Memory\\agent-memory-mesh'; npm run serve`\"\"",
    "Register-ScheduledTask -TaskName 'TSP Memory Brain' -Action $action `",
    "  -Trigger (New-ScheduledTaskTrigger -AtLogOn) -User $env:USERNAME -RunLevel Limited -Force",
  ]),
  h2("macOS"),
  ...code([
    "cat > ~/Library/LaunchAgents/com.tsp.memory-brain.plist <<'EOF'",
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<plist version=\"1.0\"><dict>",
    "  <key>Label</key><string>com.tsp.memory-brain</string>",
    "  <key>ProgramArguments</key>",
    "  <array><string>/opt/homebrew/bin/npm</string><string>run</string><string>serve</string></array>",
    "  <key>WorkingDirectory</key><string>/Users/YOUR-USERNAME/TSP-Memory/Agent-Memory/agent-memory-mesh</string>",
    "  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>",
    "  <key>RunAtLoad</key><true/>",
    "  <key>KeepAlive</key><true/>",
    "  <key>StandardOutPath</key><string>/tmp/memory-brain.log</string>",
    "  <key>StandardErrorPath</key><string>/tmp/memory-brain.log</string>",
    "</dict></plist>",
    "EOF",
    "launchctl load ~/Library/LaunchAgents/com.tsp.memory-brain.plist",
  ]),
  p("Replace YOUR-USERNAME with your actual short username, which you can see by running whoami."),
  callout("Intel Macs", [
    "The path above assumes Apple Silicon, where Homebrew installs to /opt/homebrew. On an Intel Mac it is /usr/local instead.",
    "Run `which npm` and use whatever path that prints, in both ProgramArguments and PATH.",
  ]),
  rule()
);

// ---------------------------------------------------- connect claude
children.push(
  new Paragraph({ children: [new PageBreak()] }),
  h1("7. Connect Claude"),
  p("Two parts: a folder of proposal excerpts that Claude reads, and a skill that teaches it TSP's house style."),
  h2("Step 1 — Create the snapshot folder"),
  p("A script queries your memory across seven themes — section structure, commercial terms, methodology, roles, legal boilerplate, RFP patterns, past engagements — and writes the results as Markdown."),
  p("First, tell it where your brain is. Create a small settings file:"),
  rich([["Windows", "b"]]),
  ...code([
    "mkdir \"$env:USERPROFILE\\.cowork-memory\" -Force",
    "@{ host = '127.0.0.1'; port = 8377; apiKey = '<your MEMORY_API_KEY>' } |",
    "  ConvertTo-Json | Set-Content \"$env:USERPROFILE\\.cowork-memory\\config.json\"",
  ]),
  rich([["macOS", "b"]]),
  ...code([
    "mkdir -p ~/.cowork-memory",
    "cat > ~/.cowork-memory/config.json <<'EOF'",
    "{ \"host\": \"127.0.0.1\", \"port\": 8377, \"apiKey\": \"<your MEMORY_API_KEY>\" }",
    "EOF",
  ]),
  p("Then generate the snapshot:"),
  rich([["Windows", "b"]]),
  ...code([
    "cd $env:USERPROFILE\\TSP-Memory\\Agent-Memory\\cowork-bridge",
    "Get-ChildItem -Recurse | Unblock-File",
    ".\\pull-tsp-memory.ps1 -OutputRoot \"$env:USERPROFILE\\CoworkMemory\\tsp-proposals\"",
  ]),
  rich([["macOS", "b"]]),
  ...code([
    "cd ~/TSP-Memory/Agent-Memory/cowork-bridge",
    "chmod +x pull-tsp-memory.sh",
    "./pull-tsp-memory.sh ~/CoworkMemory/tsp-proposals",
  ]),
  rich(["Expect ", ["Snapshot written: 7/7 topics", "c"], " and eight Markdown files in that folder."]),
  p("Schedule this the same way you scheduled the refresh in Section 5 — daily, shortly after the indexer runs — so the snapshot tracks the memory."),
  h2("Step 2 — Upload the skill"),
  p("In Claude, open Skills and upload this file:"),
  ...code(["<your TSP-Memory folder>/Agent-Memory/cowork-bridge/tsp-proposals-skill.zip"]),
  p("The skill carries TSP's proposal style profile, the board-approved consulting template, and the drafting lessons learned from past reviews. It loads automatically whenever you ask Claude for a proposal, SOW or RFP response."),
  h2("Step 3 — Point Claude at your snapshot folder"),
  p("Select your proposal working folder in Claude, open its folder instructions, and paste in the contents of:"),
  ...code(["<your TSP-Memory folder>/Agent-Memory/cowork-bridge/cowork-folder-instructions.md"]),
  rich(["Edit the paths in it to match where you put your snapshot, then save."]),
  callout("The two rules worth keeping", [
    "Never carry one client's specifics into another client's document. The snapshot deliberately contains excerpts from many named engagements so Claude can learn structure and phrasing — names, pricing, scope and personnel are not reusable.",
    "Never presume a platform. The corpus is heavily SAP-weighted, which has already pulled a draft toward assuming S/4HANA before any selection had happened. If the opportunity is advisory or selection-first, the proposal needs a vendor-neutral Phase 1.",
  ], WARN_BG),
  h2("Step 4 — Try it"),
  p("Ask Claude for something real, for example:"),
  p("\"Draft an executive summary and scope section for an S/4HANA assessment for a mid-market manufacturer, following our standard structure.\"", { italics: true, color: MUTED }),
  p("A good sign is Claude citing the source documents it drew structure from. If it drafts generic consulting language with no TSP specifics, check that the skill uploaded and the folder instructions were saved."),
  rule()
);

// ------------------------------------------------------- troubleshooting
children.push(
  new Paragraph({ children: [new PageBreak()] }),
  h1("8. Troubleshooting"),
  spacer(60),
  table(
    ["Symptom", "Cause and fix"],
    [
      ["npm install fails with EBADPLATFORM", "You have an old copy of the code. Run git pull in the Agent-Memory folder and install again."],
      ["Every document fails with a 401 or \"unauthorized\"", "The MEMORY_API_KEY in the two .env files does not match. They must be identical."],
      ["\"Cannot reach http://127.0.0.1:8377\"", "The brain is not running. Start it with npm run serve in agent-memory-mesh."],
      ["Indexer finds 0 files", "Wrong SharePoint path, or the files are online-only placeholders. Right-click the folder and choose \"Always keep on this device\"."],
      ["Indexer finds files but skips nearly all of them", "Usually Files On-Demand again — placeholders contain no readable text."],
      ["Scripts will not run on Windows", "Run Get-ChildItem -Recurse | Unblock-File in the script folder, then Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force in that window."],
      ["PowerShell shows >> and seems stuck", "It is waiting for a closing quote from a pasted multi-line command. Press Ctrl+C and run the command on one line."],
      ["A _STALE.md file appears in the snapshot folder", "The last snapshot attempt failed, so the files are older than they look. The file names the reason. It clears itself on the next successful run."],
      ["Claude says the memory is several days old", "The refresh or snapshot schedule is not firing. Check with Get-ScheduledTaskInfo on Windows, or the log in /tmp on macOS."],
    ],
    [3000, 6360]
  ),
  spacer(),
  h2("Getting help"),
  p("If you are stuck, the single most useful thing to send is the exact command you ran and the complete output, including the error. Most problems in this setup turn out to be one of: a path with spaces, a mismatched key, or a file that was never really synced."),
  rule(),
  h1("9. What good looks like"),
  p("When everything is working:"),
  bullet("The brain starts when you log in and you never think about it."),
  bullet("Each morning the indexer picks up whatever changed in SharePoint, in seconds."),
  bullet("The snapshot folder refreshes just after, so Claude's view tracks the corpus."),
  bullet("Asking Claude for a proposal produces TSP's structure, TSP's commercial language, and citations to real precedent."),
  spacer(),
  p("The thing to watch for is silence. If Claude ever tells you the memory is a week old, believe it and check the schedules — a stale memory that looks healthy is the one failure mode worth being alert to.", { italics: true }),
);

const doc = new Document({
  creator: "The Silicon Partners",
  title: "Build Your Own Proposal Memory",
  description: "Local AI proposal memory setup for Windows and macOS",
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 400, hanging: 220 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 760, hanging: 220 } } } },
        ],
      },
      {
        reference: "steps",
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 400, hanging: 240 } } } },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 21, color: INK } },
    },
  },
  sections: [
    {
      properties: {
        page: { size: LETTER, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = process.argv[2] || "TSP-Proposal-Memory-Setup.docx";
  fs.writeFileSync(out, buf);
  console.log("wrote", out, buf.length, "bytes");
});
